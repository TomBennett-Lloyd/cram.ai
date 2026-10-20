import { CourseId, LectureId } from '@cram/shared';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { DeckFile } from '../deck-file';
import { NOTES_SLIDE_RELATIONSHIP, NS } from './ooxml';

export const SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const NAMESPACES = `xmlns:a="${NS.a}" xmlns:p="${NS.p}" xmlns:r="${NS.r}" xmlns:mc="${NS.mc}"`;
/** APPNOTE.txt 4.4.5's method number for LZMA, which fflate does not inflate. */
const LZMA = 14;

export type FixturePlaceholder =
  'title' | 'ctrTitle' | 'subTitle' | 'body' | 'sldNum' | 'ftr' | 'dt' | 'sldImg';

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const run = (text: string, size?: string): string =>
  `<a:r>${size === undefined ? '' : `<a:rPr sz="${size}"/>`}<a:t>${escape(text)}</a:t></a:r>`;
export const lineBreak = '<a:br/>';
export const slideNumberField = (text: string): string =>
  `<a:fld id="{0}" type="slidenum"><a:t>${escape(text)}</a:t></a:fld>`;

export const paragraphOf = (...runs: readonly string[]): string =>
  `<a:p>${runs.join('')}<a:endParaRPr/></a:p>`;

/** Each paragraph is plain text, or `paragraphOf`'s XML. */
export const shape = (paragraphs: readonly string[], placeholder?: FixturePlaceholder): string => {
  const ph = placeholder === undefined ? '' : `<p:ph type="${placeholder}"/>`;
  const body = paragraphs.map((text) => (text.startsWith('<a:p>') ? text : paragraphOf(run(text))));
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body.join('')}</p:txBody></p:sp>`;
};

/** A placeholder shape with no text body, which inherits its text from the layout. */
export const bareShape = (placeholder: FixturePlaceholder): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="3" name="s"/><p:cNvSpPr/><p:nvPr><p:ph type="${placeholder}"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`;

export const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="4" name="pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/></p:blipFill><p:spPr/></p:pic>';

export const group = (...shapes: readonly string[]): string =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes.join('')}</p:grpSp>`;

export const table = (rows: readonly (readonly string[])[]): string => {
  const cells = rows.map(
    (row) =>
      `<a:tr>${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/>${paragraphOf(run(cell))}</a:txBody></a:tc>`).join('')}</a:tr>`,
  );
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData><a:tbl>${cells.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};

export const alternateContent = (choice: string, fallback: string): string =>
  `<mc:AlternateContent><mc:Choice Requires="a14">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;

export interface FixtureSlide {
  /** `p:spTree` children. */
  readonly shapes: readonly string[];
  /** Paragraphs of the notes slide's body placeholder; omitted, the slide has no notes slide. */
  readonly notes?: readonly string[];
  readonly hidden?: true;
  /** Write the notes relationship's target as an absolute part name. */
  readonly absoluteNotesTarget?: true;
}

export interface FixtureDeck {
  readonly slides: readonly FixtureSlide[];
  /** Number the slide parts in reverse of the presentation order. */
  readonly reversePartNames?: true;
  readonly presentationNamespace?: string;
  /** List one more `p:sldId` than the relationships resolve. */
  readonly danglingSlideId?: true;
  /** Part names to replace (a `Uint8Array` or text) or drop (`null`) after the deck is built. */
  readonly parts?: Readonly<Record<string, Uint8Array | string | null>>;
  /** A part name to embed with a compression method fflate cannot inflate (LZMA). */
  readonly uninflatable?: string;
}

export const FIXTURE_FILE_NAME = 'Lecture_04-Kinetics.pptx';

export const deckFile = (bytes: Uint8Array): DeckFile => ({
  bytes,
  fileName: FIXTURE_FILE_NAME,
  courseId: CourseId.parse('course-a'),
  lectureId: LectureId.parse('lecture-4'),
});

/** Enough words that a slide holding them is never read as image-only. */
export const BODY_TEXT = 'Rate laws relate rate to concentration';

export const titledSlide = (title: string): FixtureSlide => ({
  shapes: [shape([title], 'title'), shape([BODY_TEXT], 'body')],
});

const xml = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;

const relationships = (rels: readonly (readonly [string, string, string])[]): string =>
  xml(
    `<Relationships xmlns="${NS.rel}">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`,
  );

const slideXml = (slide: FixtureSlide): string =>
  xml(
    `<p:sld ${NAMESPACES}${slide.hidden ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${slide.shapes.join('')}</p:spTree></p:cSld></p:sld>`,
  );

const notesXml = (notes: readonly string[]): string =>
  xml(
    `<p:notes ${NAMESPACES}><p:cSld><p:spTree>${bareShape('sldImg')}${shape(['Notes page 3'], 'sldNum')}${shape(notes, 'body')}</p:spTree></p:cSld></p:notes>`,
  );

/** Rewrite the compression method of `name`'s local and central headers (APPNOTE.txt 4.3.7, 4.3.12). */
const setCompression = (zip: Uint8Array, name: string, method: number): void => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const encoded = strToU8(name);
  const named = (at: number): boolean => encoded.every((byte, i) => zip[at + i] === byte);
  for (let at = 0; at + 46 < zip.length; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50 && named(at + 30)) view.setUint16(at + 8, method, true);
    if (signature === 0x02014b50 && named(at + 46)) view.setUint16(at + 10, method, true);
  }
};

/** Each slide with its part number, in presentation order. */
const numbered = (deck: FixtureDeck): { slide: FixtureSlide; n: string }[] =>
  deck.slides.map((slide, index) => ({
    slide,
    n: String(deck.reversePartNames ? deck.slides.length - index : index + 1),
  }));

const slideParts = (slide: FixtureSlide, n: string): [string, string][] => {
  const rels: [string, string, string][] = [
    ['rIdImage', IMAGE_RELATIONSHIP, '../media/image1.png'],
  ];
  const parts: [string, string][] = [[`ppt/slides/slide${n}.xml`, slideXml(slide)]];
  if (slide.notes !== undefined) {
    parts.push([`ppt/notesSlides/notesSlide${n}.xml`, notesXml(slide.notes)]);
    const target = slide.absoluteNotesTarget
      ? `/ppt/notesSlides/notesSlide${n}.xml`
      : `../notesSlides/notesSlide${n}.xml`;
    rels.push(['rIdNotes', NOTES_SLIDE_RELATIONSHIP, target]);
  }
  parts.push([`ppt/slides/_rels/slide${n}.xml.rels`, relationships(rels)]);
  return parts;
};

/** A synthetic PPTX deck authored in memory for the adapter tests (docs/standards/testing.md rule 3). */
export const buildDeck = (deck: FixtureDeck): Uint8Array => {
  const numbers = numbered(deck);
  const ids = numbers.map(
    (_, index) => `<p:sldId id="${String(256 + index)}" r:id="rId${String(index + 1)}"/>`,
  );
  if (deck.danglingSlideId) ids.push(`<p:sldId id="999" r:id="rIdMissing"/>`);
  const files = new Map<string, string | Uint8Array>([
    [
      'ppt/presentation.xml',
      xml(
        `<p:presentation xmlns:p="${deck.presentationNamespace ?? NS.p}" xmlns:r="${NS.r}"><p:sldIdLst>${ids.join('')}</p:sldIdLst></p:presentation>`,
      ),
    ],
    [
      'ppt/_rels/presentation.xml.rels',
      relationships(
        numbers.map(({ n }, index) => [
          `rId${String(index + 1)}`,
          SLIDE_RELATIONSHIP,
          `slides/slide${n}.xml`,
        ]),
      ),
    ],
    ...numbers.flatMap(({ slide, n }) => slideParts(slide, n)),
  ]);
  for (const [name, content] of Object.entries(deck.parts ?? {})) {
    if (content === null) files.delete(name);
    else files.set(name, content);
  }
  const zippable: Zippable = {};
  for (const [name, content] of files)
    zippable[name] = typeof content === 'string' ? strToU8(content) : content;
  if (deck.uninflatable !== undefined)
    zippable[deck.uninflatable] = [strToU8('not really an image'), { level: 0 }];
  const zip = zipSync(zippable);
  if (deck.uninflatable !== undefined) setCompression(zip, deck.uninflatable, LZMA);
  return zip;
};
