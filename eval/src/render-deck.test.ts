import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { ingestPdf, type IngestedSlide } from '@cram/ingest';
import { CourseId } from '@cram/shared';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeckLecture } from './deck';
import { lecture, slide } from './eval-fixture';
import { EVAL_ROOT, readEvalCourse } from './read-eval-course';
import {
  BODY_SIZE,
  layoutSlide,
  PAGE,
  renderDeckPdfs,
  renderLecturePdf,
  TITLE_SIZE,
} from './render-deck';

const read = readEvalCourse();
if (read.status !== 'read') throw new Error(`eval course unreadable: ${read.where}`);
const { deck } = read.course;

const CHECKOUT_ROOT = dirname(EVAL_ROOT.replace(/\/$/, ''));

interface Rendered {
  readonly lecture: DeckLecture;
  readonly bytes: Uint8Array;
  readonly slides: readonly IngestedSlide[];
}

let dir = '';
let rendered: readonly Rendered[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cram-eval-79-'));
  const written = await renderDeckPdfs(deck, dir);
  rendered = await Promise.all(
    deck.map(async (source, index) => {
      const path = written[index]?.path ?? '';
      const bytes = new Uint8Array(await readFile(path));
      const result = await ingestPdf({
        bytes,
        fileName: path,
        courseId: CourseId.parse('hollowmere'),
        lectureId: source.lectureId,
      });
      if (result.status !== 'ingested') throw new Error(`${path}: ${result.reason}`);
      return { lecture: source, bytes, slides: result.slides };
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface PageImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** Each image a page draws, decoded, per page. */
const pageImages = async (bytes: Uint8Array): Promise<readonly (readonly PageImage[])[]> => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return (xobjects?.values() ?? []).flatMap((ref) => {
      const stream = doc.context.lookup(ref, PDFStream);
      const isImage = stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image');
      if (!isImage || !(stream instanceof PDFRawStream)) return [];
      const dimension = (key: string): number =>
        stream.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
      return [
        {
          width: dimension('Width'),
          height: dimension('Height'),
          pixels: inflateSync(stream.getContents()),
        },
      ];
    });
  });
};

const halfEm = (text: string): number => text.length / 2;
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;

describe('renderDeckPdfs over the committed deck', () => {
  it('writes one PDF per lecture, named by its lecture id, into the given directory', async () => {
    const written = await renderDeckPdfs(deck.slice(0, 1), dir);
    expect(written).toEqual([
      { lectureId: deck[0]?.lectureId, path: join(dir, `${deck[0]?.lectureId ?? ''}.pdf`) },
    ]);
  });

  it('reads every text-layer slide back through ingestPdf with its title, body and notes', () => {
    for (const { lecture: source, slides } of rendered) {
      expect(slides).toHaveLength(source.slides.length);
      source.slides.forEach((expected, index) => {
        if (expected.imageOnly) return;
        expect(slides[index]).toMatchObject({
          kind: 'content',
          record: {
            lectureTitle: source.lectureTitle,
            slideNo: expected.slideNo,
            title: expected.title,
            body: expected.body.join('\n'),
            speakerNotes: expected.speakerNotes,
          },
        });
      });
    }
  });

  it('draws each imageOnly slide as one inked image that ingestPdf reads as image-only', async () => {
    const imageOnly = deck.flatMap((source) => source.slides.filter((s) => s.imageOnly));
    expect(imageOnly.length).toBeGreaterThan(0);
    for (const { lecture: source, bytes, slides } of rendered) {
      const images = await pageImages(bytes);
      source.slides.forEach((expected, index) => {
        const drawn = images[index] ?? [];
        if (!expected.imageOnly) {
          expect(drawn).toEqual([]);
          return;
        }
        expect(slides[index]).toMatchObject({
          kind: 'image-only',
          record: { title: '', body: '' },
        });
        expect(drawn).toHaveLength(1);
        expect(drawn[0]?.pixels.some((channel) => channel < 128)).toBe(true);
      });
    }
  });

  it('annotates only the slides that carry speaker notes', async () => {
    for (const { lecture: source, bytes } of rendered) {
      const doc = await PDFDocument.load(bytes);
      const annotated = doc.getPages().map((page) => (page.node.Annots()?.size() ?? 0) > 0);
      expect(annotated).toEqual(source.slides.map((s) => s.speakerNotes !== ''));
    }
  });
});

describe('renderDeckPdfs refuses to write inside the checkout', () => {
  it.each([
    ['the eval directory', EVAL_ROOT],
    ['the checkout root', CHECKOUT_ROOT],
    ['a dot-dot-named directory in it', join(CHECKOUT_ROOT, '..renders')],
  ])('refuses %s', async (_, inside) => {
    await expect(renderDeckPdfs(deck, inside)).rejects.toThrow(/inside the checkout/);
  });

  it("accepts the checkout's parent", async () => {
    await expect(renderDeckPdfs([], dirname(CHECKOUT_ROOT))).resolves.toEqual([]);
  });
});

describe('layoutSlide', () => {
  it('sets a block that fits at its full size, each baseline one line height below the last', () => {
    const lines = layoutSlide(slide({ title: 'Comb', body: ['Cells', 'Wax'] }), halfEm);
    expect(lines).toEqual([
      { text: 'Comb', size: TITLE_SIZE, top: PAGE.margin + TITLE_SIZE * 1.4 },
      { text: 'Cells', size: BODY_SIZE, top: PAGE.margin + (TITLE_SIZE + BODY_SIZE) * 1.4 },
      { text: 'Wax', size: BODY_SIZE, top: PAGE.margin + (TITLE_SIZE + 2 * BODY_SIZE) * 1.4 },
    ]);
  });

  it('shrinks a too-wide body line until it spans the text width exactly', () => {
    const wide = 'w'.repeat(200);
    const [, body] = layoutSlide(slide({ body: [wide, 'short'] }), halfEm);
    expect(body?.size).toBeLessThan(BODY_SIZE);
    expect((body?.size ?? 0) * halfEm(wide)).toBeCloseTo(TEXT_WIDTH);
  });

  it('shrinks a long body until its last baseline meets the bottom margin', () => {
    const body = Array.from({ length: 30 }, (_, n) => `Item ${String(n)}`);
    const lines = layoutSlide(slide({ body }), halfEm);
    expect(lines[1]?.size).toBeLessThan(BODY_SIZE);
    expect(lines.at(-1)?.top).toBeCloseTo(PAGE.height - PAGE.margin);
  });

  it('keeps the body below a title that had to shrink', () => {
    const title = 't'.repeat(200);
    const [heading, body] = layoutSlide(slide({ title, body: ['Cells'] }), halfEm);
    expect((heading?.size ?? 0) * halfEm(title)).toBeCloseTo(TEXT_WIDTH);
    expect(body?.size).toBeLessThan(heading?.size ?? 0);
  });
});

describe('an imageOnly slide too large for the page', () => {
  const rasterOf = async (overrides: Parameters<typeof slide>[0]): Promise<PageImage> => {
    const bytes = await renderLecturePdf(lecture('l1', [slide({ imageOnly: true, ...overrides })]));
    const image = (await pageImages(bytes))[0]?.[0];
    if (image === undefined) throw new Error('no image drawn');
    return image;
  };

  it('widens the raster to hold its widest line', async () => {
    const image = await rasterOf({ body: ['w'.repeat(300)] });
    expect(image.width).toBeGreaterThan(2 * PAGE.width);
  });

  it('lengthens the raster to hold every line', async () => {
    const image = await rasterOf({
      body: Array.from({ length: 60 }, (_, n) => `Item ${String(n)}`),
    });
    expect(image.height).toBeGreaterThan(2 * PAGE.height);
  });
});
