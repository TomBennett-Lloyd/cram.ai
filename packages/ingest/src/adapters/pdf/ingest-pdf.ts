import { createHash } from 'node:crypto';
import { SourceHash, type CourseId, type LectureId } from '@cram/shared';
import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { slidesFromPages } from '../../deck';
import type { IngestedSlide, PageText, TextLine } from '../../page-text';

export interface PdfDeck {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
}

export type UnreadableReason = 'not-a-pdf' | 'encrypted' | 'damaged';

export type PdfIngestResult =
  | { readonly status: 'ingested'; readonly slides: readonly IngestedSlide[] }
  | {
      readonly status: 'unreadable';
      readonly fileName: string;
      readonly reason: UnreadableReason;
      readonly detail: string;
    };

const TextItem = z.object({
  str: z.string(),
  transform: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  hasEOL: z.boolean(),
});

const Annotation = z.object({
  subtype: z.string().nullable(),
  contentsObj: z.object({ str: z.string() }).optional(),
});

/** The pdf.js exceptions a deck's own bytes can raise: values, not bugs (docs/standards/error-handling.md rule 1). */
const PdfjsException = z.object({
  name: z.enum(['InvalidPDFException', 'PasswordException', 'UnknownErrorException']),
  message: z.string(),
});

const UNREADABLE: Record<z.infer<typeof PdfjsException>['name'], UnreadableReason> = {
  InvalidPDFException: 'not-a-pdf',
  PasswordException: 'encrypted',
  UnknownErrorException: 'damaged',
};

/** Hundredths of a point: pdf.js composes matrices in floating point, so equal sizes can differ in the last bits. */
const glyphSize = (transform: z.infer<typeof TextItem>['transform']): number =>
  Math.round(Math.hypot(transform[2], transform[3]) * 100) / 100;

/** pdf.js ends a line with `hasEOL`; a line's size is its largest non-blank glyph. */
const linesOf = (items: readonly unknown[]): TextLine[] => {
  const lines: TextLine[] = [];
  let text = '';
  let size = 0;
  for (const item of z.array(TextItem).parse(items)) {
    text += item.str;
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

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const pagesOf = async (pdf: PdfDocument): Promise<PageText[]> => {
  const pages: PageText[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const { items } = await page.getTextContent();
    const annotations = z.array(Annotation).parse(await page.getAnnotations());
    const notes = annotations
      .filter((annotation) => annotation.subtype === 'Text')
      .map((annotation) => annotation.contentsObj?.str ?? '')
      .join('\n');
    pages.push({ lines: linesOf(items), notes });
  }
  return pages;
};

/** A PDF deck as one slide per page. pdf.js gets a copy of the bytes, which it detaches, and never a URL (ingest-pdf.test.ts). */
export const ingestPdf = async (deck: PdfDeck): Promise<PdfIngestResult> => {
  const sourceHash = SourceHash.parse(createHash('sha256').update(deck.bytes).digest('hex'));
  let pages: PageText[];
  try {
    const pdf = await getDocumentProxy(deck.bytes.slice(), { verbosity: 0 });
    try {
      pages = await pagesOf(pdf);
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
      reason: UNREADABLE[known.data.name],
      detail: known.data.message,
    };
  }
  return {
    status: 'ingested',
    slides: slidesFromPages(pages, { ...deck, sourceHash }),
  };
};
