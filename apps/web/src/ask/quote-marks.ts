import type { SlideRecord } from '@cram/shared';

/** A run of one field's text, marked when a cited quote covers it. */
export interface Segment {
  readonly text: string;
  readonly marked: boolean;
}

export type FieldName = 'title' | 'body' | 'speakerNotes' | 'imageCaption';

export interface MarkedField {
  readonly field: FieldName;
  readonly segments: readonly Segment[];
}

interface Range {
  readonly start: number;
  readonly end: number;
}

/** The slide's fields in `@cram/grounding`'s `slideText` order, blank ones left out, as quotes resolve against them. */
const fieldsOf = (record: SlideRecord): readonly { field: FieldName; text: string }[] =>
  [
    { field: 'title' as const, text: record.title },
    { field: 'body' as const, text: record.body },
    { field: 'speakerNotes' as const, text: record.speakerNotes },
    ...record.imageCaptions.map((text) => ({ field: 'imageCaption' as const, text })),
  ].filter(({ text }) => /\S/.test(text));

/** `text` with each whitespace run read as one space, and where each kept character came from. */
const collapsed = (text: string): { readonly text: string; readonly origin: readonly number[] } => {
  let out = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const space = /\s/.test(text.charAt(index));
    if (space && out.endsWith(' ')) continue;
    out += space ? ' ' : text.charAt(index);
    origin.push(index);
  }
  return { text: out, origin };
};

/**
 * Where `quote` sits in `text`, compared whitespace-normalised as resolution compares it. A miss
 * (`at` of -1) and a blank quote both index `origin` out of range, so both are `undefined`.
 */
const rangeOf = (text: string, quote: string): Range | undefined => {
  const haystack = collapsed(text);
  const needle = collapsed(quote).text.trim();
  const at = haystack.text.indexOf(needle);
  const start = haystack.origin[at];
  const end = haystack.origin[at + needle.length - 1];
  return start === undefined || end === undefined ? undefined : { start, end: end + 1 };
};

const segmentsOf = (text: string, offset: number, ranges: readonly Range[]): Segment[] => {
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
  const fields = fieldsOf(record);
  const joined = fields.map(({ text }) => text).join('\n');
  const ranges = quotes
    .map((quote) => rangeOf(joined, quote))
    .filter((range) => range !== undefined)
    .sort((a, b) => a.start - b.start);
  let offset = 0;
  return fields.map(({ field, text }) => {
    const marked = { field, segments: segmentsOf(text, offset, ranges) };
    offset += text.length + 1;
    return marked;
  });
};
