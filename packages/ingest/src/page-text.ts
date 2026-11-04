/** Where a line sits on its page, in PDF user space (y grows upward). */
export interface LineBox {
  readonly left: number;
  readonly right: number;
  readonly baseline: number;
}

/** One line of a page's text layer, in reading order; `box` is absent where the format gives no geometry (PPTX). */
export interface TextLine {
  readonly text: string;
  readonly size: number;
  readonly box?: LineBox;
}

/** A page as a format adapter reads it: the boundary every deck format (PDF, PPTX #10) produces. */
export interface PageText {
  readonly markedTitle?: string;
  readonly lines: readonly TextLine[];
  readonly notes: string;
}
