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
  UnreadablePptx,
  type Parts,
  type PptxUnreadableReason,
} from './ooxml';
import { notesText, slideContent } from './slide-xml';

export type PptxIngestResult = IngestResult<PptxUnreadableReason>;

const PRESENTATION = 'ppt/presentation.xml';

const ZIP_MAGIC = [0x50, 0x4b];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** The stream an OLE compound file holds a password-protected OOXML package in, as its UTF-16LE directory entry names it. */
const ENCRYPTED_PACKAGE = Buffer.from('EncryptedPackage', 'utf16le');

/** fflate's own errors carry a numeric `code`: the archive's fault, not ours. */
const FlateError = z.object({ code: z.number(), message: z.string() });

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  magic.every((byte, index) => bytes[index] === byte);

/** Bytes that are not a zip: an encrypted package, or not a PPTX at all. */
const notZip = (bytes: Uint8Array): UnreadablePptx => {
  if (!startsWith(bytes, OLE_MAGIC)) return new UnreadablePptx('not-a-pptx', 'not a zip archive');
  return Buffer.from(bytes).includes(ENCRYPTED_PACKAGE)
    ? new UnreadablePptx('encrypted', 'an encrypted OOXML package')
    : new UnreadablePptx('not-a-pptx', 'an OLE compound file, not OOXML');
};

/** Only XML parts are inflated, so embedded media is never read. */
const unzipParts = (bytes: Uint8Array): Parts => {
  try {
    return unzipSync(bytes, { filter: ({ name }) => /\.(xml|rels)$/.test(name) });
  } catch (error) {
    const flate = FlateError.safeParse(error);
    if (!flate.success) throw error;
    throw new UnreadablePptx('damaged', flate.data.message, { cause: error });
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

/** One page per `p:sldId`, in the presentation's order, which part names do not follow. */
const pagesOf = (parts: Parts): PageText[] => {
  if (parts[PRESENTATION] === undefined)
    throw new UnreadablePptx('not-a-pptx', `no ${PRESENTATION}`);
  const presentation = readXml(parts, PRESENTATION);
  if (presentation.documentElement?.namespaceURI !== NS.p)
    throw new UnreadablePptx('not-a-pptx', `${PRESENTATION} is not transitional PresentationML`);
  const slides = relationshipsOf(parts, PRESENTATION);
  return [...presentation.getElementsByTagNameNS(NS.p, 'sldId')].map((sldId) => {
    const id = sldId.getAttributeNS(NS.r, 'id') ?? '';
    const slide = slides.get(id);
    if (slide === undefined)
      throw new UnreadablePptx('damaged', `${PRESENTATION} lists slide ${id} with no relationship`);
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
  };
};
