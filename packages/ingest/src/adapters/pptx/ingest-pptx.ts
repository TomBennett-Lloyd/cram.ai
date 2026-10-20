import { unzipSync } from 'fflate';
import { z } from 'zod';
import { slidesFromPages } from '../../deck';
import type { PageText } from '../../page-text';
import { sourceHashOf, type DeckFile, type IngestResult } from '../deck-file';
import {
  NOTES_SLIDE_RELATIONSHIP,
  NS,
  readXml,
  relationshipsOf,
  startsWith,
  UnreadablePptx,
  type Parts,
  type PptxUnreadableReason,
} from './ooxml';
import { notesText, slideContent } from './slide-xml';

export type PptxIngestResult = IngestResult<PptxUnreadableReason>;

/** The package itself, whose relationships part is `_rels/.rels` (ECMA-376 Part 2 §9.3). */
const PACKAGE = '';
/** The package relationship to the main part, in Transitional and in Strict, so a Strict deck reaches its own reason. */
const OFFICE_DOCUMENT_RELATIONSHIPS: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
/** ISO/IEC 29500 Strict's PresentationML namespace: a conforming deck this reader does not read, unlike any other root. */
const STRICT_PRESENTATIONML = 'http://purl.oclc.org/ooxml/presentationml/main';

const ZIP_MAGIC = [0x50, 0x4b];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** The stream an OLE compound file holds a password-protected OOXML package in, as its UTF-16LE directory entry names it. */
const ENCRYPTED_PACKAGE = Buffer.from('EncryptedPackage', 'utf16le');

/** fflate's own errors carry a numeric `code`: the archive's fault, not ours. */
const FlateError = z.object({ code: z.number(), message: z.string() });

/** Bytes that are not a zip: an encrypted package, or not a PPTX at all. */
const notZip = (bytes: Uint8Array): UnreadablePptx => {
  if (!startsWith(bytes, OLE_MAGIC)) return new UnreadablePptx('not-zip', 'not a zip archive');
  return Buffer.from(bytes).includes(ENCRYPTED_PACKAGE)
    ? new UnreadablePptx('encrypted-package', 'an encrypted OOXML package')
    : new UnreadablePptx('not-ooxml', 'an OLE compound file, not OOXML');
};

/** Only XML parts are inflated, so embedded media is never read. */
const unzipParts = (bytes: Uint8Array): Parts => {
  try {
    return unzipSync(bytes, { filter: ({ name }) => /\.(xml|rels)$/.test(name) });
  } catch (error) {
    const flate = FlateError.safeParse(error);
    if (!flate.success) throw error;
    throw new UnreadablePptx('corrupt-zip', flate.data.message, { cause: error });
  }
};

const pageOf = (parts: Parts, slidePart: string): PageText => {
  const notesPart = [...relationshipsOf(parts, slidePart).values()].find(
    ({ type }) => type === NOTES_SLIDE_RELATIONSHIP,
  )?.target;
  return {
    ...slideContent(readXml(parts, slidePart)),
    notes: notesPart === undefined ? '' : notesText(readXml(parts, notesPart)),
  };
};

const presentationPartOf = (parts: Parts): string => {
  const main = [...relationshipsOf(parts, PACKAGE).values()].find(({ type }) =>
    OFFICE_DOCUMENT_RELATIONSHIPS.has(type),
  );
  if (main === undefined)
    throw new UnreadablePptx('no-presentation', 'no officeDocument relationship in _rels/.rels');
  return main.target;
};

/** One page per `p:sldId`, in the presentation's order (ingest-pptx.test.ts). */
const pagesOf = (parts: Parts): PageText[] => {
  const presentationPart = presentationPartOf(parts);
  const presentation = readXml(parts, presentationPart);
  const namespace = presentation.documentElement?.namespaceURI;
  if (namespace === STRICT_PRESENTATIONML)
    throw new UnreadablePptx(
      'strict-presentationml',
      `${presentationPart} is Strict PresentationML`,
    );
  if (namespace !== NS.p)
    throw new UnreadablePptx('not-presentationml', `${presentationPart} is not PresentationML`);
  const slides = relationshipsOf(parts, presentationPart);
  return [...presentation.getElementsByTagNameNS(NS.p, 'sldId')].map((sldId) => {
    const id = sldId.getAttributeNS(NS.r, 'id') ?? '';
    const slide = slides.get(id);
    if (slide === undefined)
      throw new UnreadablePptx(
        'unresolved-slide',
        `${presentationPart} lists slide ${id} with no relationship`,
      );
    return pageOf(parts, slide.target);
  });
};

const readPages = (bytes: Uint8Array): PageText[] => {
  if (!startsWith(bytes, ZIP_MAGIC)) throw notZip(bytes);
  return pagesOf(unzipParts(bytes));
};

/** A PPTX deck as one slide per presentation slide, hidden ones included, so `slideNo` is PowerPoint's own number. */
export const ingestPptx = (deck: DeckFile): PptxIngestResult => {
  let pages: PageText[];
  try {
    pages = readPages(deck.bytes);
  } catch (error) {
    if (!(error instanceof UnreadablePptx))
      throw new Error(`ingestPptx: reading ${deck.fileName} failed`, { cause: error });
    return {
      status: 'unreadable',
      fileName: deck.fileName,
      reason: error.reason,
      detail: error.message,
    };
  }
  return {
    status: 'ingested',
    slides: slidesFromPages(pages, { ...deck, sourceHash: sourceHashOf(deck.bytes) }),
    images: [],
  };
};
