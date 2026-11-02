import { SLIDE_FIELD_SEPARATOR, type SlideRecord, slideFields } from '@cram/shared';

/** What a quote must be a substring of (`docs/standards/grounding.md` rule 3). */
export const slideText = (record: SlideRecord): string =>
  slideFields(record)
    .map(({ text }) => text)
    .join(SLIDE_FIELD_SEPARATOR);

const nonBlank = (text: string): boolean => /\S/.test(text);

/** The lines a citation names by number, counted from 1: the generator is shown these and a quote is looked up in them (#367). */
export const slideLines = (record: SlideRecord): readonly string[] =>
  slideFields(record)
    .flatMap(({ text }) => text.split('\n'))
    .filter(nonBlank)
    .map((line) => line.trim());
