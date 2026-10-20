export { slidesFromPages, UNTITLED_LECTURE, type DeckSource } from './deck';
export type { IngestedSlide, PageText, SlideKind, TextLine } from './page-text';
export {
  ingestPdf,
  type PdfDeck,
  type PdfIngestResult,
  type UnreadableReason,
} from './adapters/pdf/ingest-pdf';
export {
  BULLET_MARKERS,
  REFERENCES_TITLE,
  slideText,
  THIN_TEXT_LAYER_WORDS,
  type SlideText,
} from './slide-text';
