import type { SlideRecord } from './slide-record';

export type SlideFieldName = 'title' | 'body' | 'speakerNotes' | 'imageCaption';

export interface SlideField {
  readonly field: SlideFieldName;
  readonly text: string;
}

/** Indices into the searched text, `end` exclusive. */
export interface QuoteSpan {
  readonly start: number;
  readonly end: number;
}

/** The fields a quote resolves against, in reading order, blank ones left out (#202). */
export const slideFields = (record: SlideRecord): readonly SlideField[] =>
  [
    { field: 'title' as const, text: record.title },
    { field: 'body' as const, text: record.body },
    { field: 'speakerNotes' as const, text: record.speakerNotes },
    ...record.imageCaptions.map((text) => ({ field: 'imageCaption' as const, text })),
  ].filter(({ text }) => /\S/.test(text));

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

/** Where `quote` sits in `text`, whitespace runs read as one space, nothing else normalised (`docs/standards/grounding.md` rule 3). */
export const quoteSpan = (text: string, quote: string): QuoteSpan | undefined => {
  const haystack = collapsed(text);
  const needle = collapsed(quote).text.trim();
  const at = haystack.text.indexOf(needle);
  const start = haystack.origin[at];
  const end = haystack.origin[at + needle.length - 1];
  return start === undefined || end === undefined ? undefined : { start, end: end + 1 };
};
