import { SLIDE_FIELD_SEPARATOR, type SlideRecord, slideFields } from '@cram/shared';

/** What the generator is shown and what a quote must come from: one function, so the two cannot differ. */
export const slideText = (record: SlideRecord): string =>
  slideFields(record)
    .map(({ text }) => text)
    .join(SLIDE_FIELD_SEPARATOR);
