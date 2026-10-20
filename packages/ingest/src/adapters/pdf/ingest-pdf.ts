import { SlideNo, type SlideImage } from '@cram/shared';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { slidesFromPages } from '../../deck';
import type { PageText, TextLine } from '../../page-text';
import { sourceHashOf, type DeckFile, type IngestResult } from '../deck-file';
import { logicalOrder } from './logical-order';
import { renderSlideImage, type PdfDocument } from './render-page';

const TextItem = z.object({
  str: z.string(),
  transform: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  hasEOL: z.boolean(),
});

const Annotation = z.object({
  subtype: z.string().nullable(),
  contentsObj: z.object({ str: z.string() }).optional(),
});

/** The pdf.js exceptions returned as values, not bugs (docs/standards/error-handling.md rule 1). */
const PdfjsException = z.object({
  name: z.enum(['InvalidPDFException', 'PasswordException', 'UnknownErrorException']),
  message: z.string(),
});

/** `UnknownErrorException` is pdf.js's catch-all, its own limits included, so it blames this reader (docs/standards/error-handling.md rule 1). */
const UNREADABLE = {
  InvalidPDFException: 'not-a-pdf',
  PasswordException: 'encrypted',
  UnknownErrorException: 'reader-limit',
} as const satisfies Record<z.infer<typeof PdfjsException>['name'], string>;

/** pdf.js's messages for a page tree no reader could walk; a reworded one reads as `reader-limit` (ingest-pdf.test.ts). */
const DAMAGED_PAGE_TREE: ReadonlySet<string> = new Set([
  'Page dictionary kid reference points to wrong type of object.',
  'Page dictionary kids object is not an array.',
  'Pages tree contains circular reference.',
]);

const reasonOf = ({ name, message }: z.infer<typeof PdfjsException>) =>
  DAMAGED_PAGE_TREE.has(message) ? 'damaged' : UNREADABLE[name];

/** Derived from `reasonOf`, so every reason has an exception that produces it (#185). */
export type PdfUnreadableReason = ReturnType<typeof reasonOf>;

export type PdfIngestResult = IngestResult<PdfUnreadableReason>;

/** Hundredths of a point: pdf.js composes matrices in floating point, so equal sizes can differ in the last bits. */
const glyphSize = (transform: z.infer<typeof TextItem>['transform']): number =>
  Math.round(Math.hypot(transform[2], transform[3]) * 100) / 100;

/** pdf.js ends a line with `hasEOL`; a line's size is its largest non-blank glyph. */
const linesOf = (items: readonly unknown[]): TextLine[] => {
  const lines: TextLine[] = [];
  let text = '';
  let size = 0;
  for (const item of z.array(TextItem).parse(items)) {
    text += logicalOrder(item.str);
    if (item.str.trim() !== '') size = Math.max(size, glyphSize(item.transform));
    if (item.hasEOL) {
      lines.push({ text, size });
      text = '';
      size = 0;
    }
  }
  lines.push({ text, size });
  return lines;
};

interface ReadDeck {
  readonly pages: readonly PageText[];
  readonly images: readonly SlideImage[];
}

/** Each page's text with pdf.js's own Unicode fold off, so `storedText`'s is the only one (#256), and its rendering. */
const read = async (pdf: PdfDocument): Promise<ReadDeck> => {
  const pages: PageText[] = [];
  const images: SlideImage[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const { items } = await page.getTextContent({ disableNormalization: true });
    const annotations = z.array(Annotation).parse(await page.getAnnotations());
    const notes = annotations
      .filter((annotation) => annotation.subtype === 'Text')
      .map((annotation) => annotation.contentsObj?.str ?? '')
      .join('\n');
    pages.push({ lines: linesOf(items), notes });
    images.push(await renderSlideImage(pdf, SlideNo.parse(pageNo)));
  }
  return { pages, images };
};

/** A PDF deck as one slide and one rendered image per page. pdf.js gets a plain copy of the bytes, since it detaches them and refuses a `Buffer`, and never a URL (ingest-pdf.test.ts). */
export const ingestPdf = async (deck: DeckFile): Promise<PdfIngestResult> => {
  const sourceHash = sourceHashOf(deck.bytes);
  let deckRead: ReadDeck;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(deck.bytes), { verbosity: 0 });
    try {
      deckRead = await read(pdf);
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    const known = PdfjsException.safeParse(error);
    if (!known.success)
      throw new Error(`ingestPdf: reading ${deck.fileName} failed`, { cause: error });
    return {
      status: 'unreadable',
      fileName: deck.fileName,
      reason: reasonOf(known.data),
      detail: known.data.message,
    };
  }
  return {
    status: 'ingested',
    slides: slidesFromPages(deckRead.pages, { ...deck, sourceHash }),
    images: deckRead.images,
  };
};
