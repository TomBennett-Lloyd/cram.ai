import { SlideNo, type SlideImage } from '@cram/shared';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { slidesFromPages } from '../../deck';
import type { PageText } from '../../page-text';
import { sourceHashOf, type DeckFile, type IngestResult } from '../deck-file';
import { layOutPages, pageTextOf, type PdfPageText } from './page-layout';
import { renderSlideImage, type PdfDocument } from './render-page';

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

interface ReadDeck {
  readonly pages: readonly PageText[];
  readonly images: readonly SlideImage[];
}

const read = async (pdf: PdfDocument): Promise<ReadDeck> => {
  const texts: (PdfPageText & { readonly notes: string })[] = [];
  const images: SlideImage[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const annotations = z.array(Annotation).parse(await page.getAnnotations());
    const notes = annotations
      .filter((annotation) => annotation.subtype === 'Text')
      .map((annotation) => annotation.contentsObj?.str ?? '')
      .join('\n');
    texts.push({ ...(await pageTextOf(pdf, pageNo)), notes });
    images.push(await renderSlideImage(pdf, SlideNo.parse(pageNo)));
  }
  const pages = layOutPages(texts).map(({ page, lines, footer }): PageText => ({
    lines,
    footer: footer.map((line) => line.text),
    notes: page.notes,
  }));
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
