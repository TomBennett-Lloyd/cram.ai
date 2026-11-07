import {
  type QuotableFields,
  SLIDE_FIELD_SEPARATOR,
  type SlideRecord,
  slideFields,
  whitespaceNormalised,
} from '@cram/shared';

/** What a quote must be a substring of (`docs/standards/grounding.md` rule 3); a chunk's text is the same fields' (#426). */
export const slideText = (record: QuotableFields): string =>
  slideFields(record)
    .map(({ text }) => text)
    .join(SLIDE_FIELD_SEPARATOR);

const nonBlank = (text: string): boolean => /\S/.test(text);

/** The lines the generator is shown, one to a row, and the lines a citation's copy is looked up in (#367, #481). */
export const slideLines = (record: SlideRecord): readonly string[] =>
  slideFields(record)
    .flatMap(({ text }) => text.split('\n'))
    .filter(nonBlank)
    .map((line) => line.trim());

export const copiedLines = (record: SlideRecord, copy: string): readonly string[] =>
  slideLines(record).filter((line) => whitespaceNormalised(line) === whitespaceNormalised(copy));

export const copiedLine = (record: SlideRecord, copy: string): string | undefined => {
  const [only, ...more] = copiedLines(record, copy);
  return more.length === 0 ? only : undefined;
};
