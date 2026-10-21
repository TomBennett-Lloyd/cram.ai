export { slidesFromPages, UNTITLED_LECTURE, type DeckSource } from './deck';
export type { PageText, TextLine } from './page-text';
export type { DeckFile, IngestResult } from './adapters/deck-file';
export {
  ingestPdf,
  type PdfIngestResult,
  type PdfUnreadableReason,
} from './adapters/pdf/ingest-pdf';
export { SLIDE_IMAGE_LONG_EDGE_PX } from './adapters/pdf/render-page';
export { ingestPptx, type PptxIngestResult } from './adapters/pptx/ingest-pptx';
export type { PptxUnreadableReason } from './adapters/pptx/ooxml';
export {
  BULLET_MARKERS,
  REFERENCES_TITLE,
  slideText,
  THIN_TEXT_LAYER_WORDS,
  type SlideText,
} from './slide-text';
