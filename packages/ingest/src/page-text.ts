/** One line of a page's text layer, in reading order. */
export interface TextLine {
  readonly text: string;
  readonly size: number;
}

/** A page as a format adapter reads it: the boundary every deck format (PDF, PPTX #10) produces. */
export interface PageText {
  readonly markedTitle?: string;
  readonly lines: readonly TextLine[];
  readonly notes: string;
}
