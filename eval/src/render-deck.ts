import { writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp, loadFont, measureText } from 'jimp';
import { SANS_32_BLACK, SANS_64_BLACK } from 'jimp/fonts';
import { PDFDocument, PDFHexString, PDFName, StandardFonts, type PDFPage } from 'pdf-lib';
import type { Deck, DeckLecture, DeckSlide } from './deck';

/** In points; a 16:9 slide. */
export const PAGE = { width: 960, height: 540, margin: 40 } as const;
export const TITLE_SIZE = 40;
/** Scaled with the title, so the body stays smaller and `slideText` (packages/ingest/src/slide-text.ts) finds the title. */
export const BODY_SIZE = 24;
const LINE_HEIGHT = 1.4;

/** Width of `text` set at size 1, in points. */
type Measure = (text: string) => number;

export interface PlacedLine {
  readonly text: string;
  readonly size: number;
  /** Baseline, in points down from the top of the page. */
  readonly top: number;
}

/** The largest size up to `max` at which `lines` fit the text width and `height`. */
const fit = (lines: readonly string[], max: number, height: number, measure: Measure): number => {
  const widest = Math.max(...lines.map(measure));
  return Math.min(
    max,
    (PAGE.width - 2 * PAGE.margin) / widest,
    height / (lines.length * LINE_HEIGHT),
  );
};

/** The title, then one body item per line, each block shrunk until it fits the page. */
export const layoutSlide = (slide: DeckSlide, measure: Measure): readonly PlacedLine[] => {
  const usable = PAGE.height - 2 * PAGE.margin;
  const titleSize = fit([slide.title], TITLE_SIZE, usable, measure);
  const bodyMax = (BODY_SIZE * titleSize) / TITLE_SIZE;
  const bodySize = fit(slide.body, bodyMax, usable - titleSize * LINE_HEIGHT, measure);
  let top = PAGE.margin;
  return [
    { text: slide.title, size: titleSize },
    ...slide.body.map((text) => ({ text, size: bodySize })),
  ].map((line) => {
    top += line.size * LINE_HEIGHT;
    return { ...line, top };
  });
};

/** jimp's bitmap Open Sans at two of its fixed pixel sizes. */
const RASTER_TITLE_FONT = SANS_64_BLACK;
const RASTER_BODY_FONT = SANS_32_BLACK;
/** The raster's minimum size, in pixels: the page at two pixels per point. */
const RASTER_MIN = { width: PAGE.width * 2, height: PAGE.height * 2 } as const;

/**
 * The slide's face as a PNG, so its text exists only as pixels
 * (docs/adr/0005-evaluation-as-gate.md § Decision (a)). jimp's fonts come in fixed
 * sizes, so the raster grows to hold its widest line and the page scales it to fit.
 * jimp prints `?` for a character its font lacks, so such a character is refused.
 */
const rasteriseSlide = async (lecture: DeckLecture, slide: DeckSlide): Promise<Uint8Array> => {
  const [titleFont, bodyFont] = await Promise.all([
    loadFont(RASTER_TITLE_FONT),
    loadFont(RASTER_BODY_FONT),
  ]);
  const lines = [
    { text: slide.title, font: titleFont },
    ...slide.body.map((text) => ({ text, font: bodyFont })),
  ];
  for (const { text, font } of lines) {
    for (const char of text) {
      if (!Object.hasOwn(font.chars, char))
        throw new Error(
          `renderLecturePdf: ${lecture.lectureId} slide ${String(slide.slideNo)}: no raster glyph for ${JSON.stringify(char)}`,
        );
    }
  }
  const margin = PAGE.margin * 2;
  const width = Math.max(
    RASTER_MIN.width,
    ...lines.map(({ text, font }) => measureText(font, text) + 2 * margin),
  );
  const height = Math.max(
    RASTER_MIN.height,
    lines.reduce((total, { font }) => total + font.common.lineHeight, 2 * margin),
  );
  const image = new Jimp({ width, height, color: 0xffffffff });
  let y = margin;
  for (const { text, font } of lines) {
    image.print({ font, x: margin, y, text });
    y += font.common.lineHeight;
  }
  return image.getBuffer('image/png');
};

/** A `Text` annotation, where `ingestPdf` reads speaker notes (packages/ingest/src/adapters/pdf/ingest-pdf.ts). */
const addNotes = (doc: PDFDocument, page: PDFPage, notes: string): void => {
  const annotation = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [0, 0, 10, 10],
      Contents: PDFHexString.fromText(notes),
    }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
};

/** One page per slide, in slide order: a text layer, or for an `imageOnly` slide a single image. */
export const renderLecturePdf = async (lecture: DeckLecture): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const measure: Measure = (text) => font.widthOfTextAtSize(text, 1);
  for (const slide of lecture.slides) {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    if (slide.imageOnly) {
      const image = await doc.embedPng(await rasteriseSlide(lecture, slide));
      const { width, height } = image.scaleToFit(PAGE.width, PAGE.height);
      page.drawImage(image, { x: 0, y: PAGE.height - height, width, height });
    } else {
      for (const line of layoutSlide(slide, measure)) {
        page.drawText(line.text, {
          x: PAGE.margin,
          y: PAGE.height - line.top,
          size: line.size,
          font,
        });
      }
    }
    if (slide.speakerNotes !== '') addNotes(doc, page, slide.speakerNotes);
  }
  return doc.save();
};

/** This checkout's root: renderings are never written inside it (.claude/scripts/check-no-course-content.sh). */
const CHECKOUT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface RenderedLecture {
  readonly lectureId: DeckLecture['lectureId'];
  readonly path: string;
}

/** Writes `<lectureId>.pdf` per lecture into `dir`, which must lie outside this checkout. */
export const renderDeckPdfs = async (
  deck: Deck,
  dir: string,
): Promise<readonly RenderedLecture[]> => {
  const fromRoot = relative(CHECKOUT_ROOT, dir);
  if (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
    throw new Error(`renderDeckPdfs: ${dir} is inside the checkout; render to a temp directory`);
  const rendered: RenderedLecture[] = [];
  for (const lecture of deck) {
    const path = join(dir, `${lecture.lectureId}.pdf`);
    await writeFile(path, await renderLecturePdf(lecture));
    rendered.push({ lectureId: lecture.lectureId, path });
  }
  return rendered;
};
