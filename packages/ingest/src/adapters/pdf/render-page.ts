import { SlideImage, type SlideNo } from '@cram/shared';
import { type getDocumentProxy, renderPageAsImage } from 'unpdf';

export type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** A stored slide image's longer side in pixels, tuned against derived-text recall (#108, docs/adr/0006-image-only-slides.md § Decision (h)). */
export const SLIDE_IMAGE_LONG_EDGE_PX = 1920;

export const renderSlideImage = async (pdf: PdfDocument, slideNo: SlideNo): Promise<SlideImage> => {
  const page = await pdf.getPage(slideNo);
  const { width, height } = page.getViewport({ scale: 1 });
  const png = await renderPageAsImage(pdf, slideNo, {
    canvasImport: () => import('@napi-rs/canvas'),
    // The canvas truncates its size; half a pixel keeps a rounded-down quotient whole (ingest-pdf.test.ts).
    scale: (SLIDE_IMAGE_LONG_EDGE_PX + 0.5) / Math.max(width, height),
  });
  return SlideImage.parse({ slideNo, mediaType: 'image/png', content: new Uint8Array(png) });
};
