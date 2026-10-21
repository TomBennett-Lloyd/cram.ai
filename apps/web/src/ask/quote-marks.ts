import {
  type QuoteSpan,
  quoteSpan,
  type SlideFieldName,
  slideFields,
  type SlideRecord,
} from '@cram/shared';

/** A run of one field's text, marked when a cited quote covers it. */
export interface Segment {
  readonly text: string;
  readonly marked: boolean;
}

export interface MarkedField {
  readonly field: SlideFieldName;
  readonly segments: readonly Segment[];
}

const segmentsOf = (text: string, offset: number, ranges: readonly QuoteSpan[]): Segment[] => {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    const from = Math.max(start - offset, cursor);
    const to = Math.min(end - offset, text.length);
    if (to <= from) continue;
    if (from > cursor) segments.push({ text: text.slice(cursor, from), marked: false });
    segments.push({ text: text.slice(from, to), marked: true });
    cursor = to;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments;
};

/** Each field of the slide, with the spans its cited quotes cover marked; a quote may cross fields. */
export const markedFields = (record: SlideRecord, quotes: readonly string[]): MarkedField[] => {
  const fields = slideFields(record);
  const joined = fields.map(({ text }) => text).join('\n');
  const ranges = quotes
    .map((quote) => quoteSpan(joined, quote))
    .filter((range) => range !== undefined)
    .sort((a, b) => a.start - b.start);
  let offset = 0;
  return fields.map(({ field, text }) => {
    const marked = { field, segments: segmentsOf(text, offset, ranges) };
    offset += text.length + 1;
    return marked;
  });
};
