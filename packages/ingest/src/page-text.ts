import type { SlideRecord } from '@cram/shared';

/** One line of a page's text layer, in reading order; `size` is the largest glyph size on it. */
export interface TextLine {
  readonly text: string;
  readonly size: number;
}

/** A page as a format adapter reads it: the boundary every deck format (PDF, PPTX #10) produces. */
export interface PageText {
  readonly lines: readonly TextLine[];
  readonly notes: string;
}

/** `image-only`: the text layer is empty or thin, so `body` is '' and the page awaits OCR (#6). */
export type SlideKind = 'content' | 'references' | 'image-only';

export interface IngestedSlide {
  readonly kind: SlideKind;
  readonly record: SlideRecord;
}
