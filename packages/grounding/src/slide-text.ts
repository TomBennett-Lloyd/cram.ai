import type { SlideRecord } from '@cram/shared';

/** What the generator is shown and what a quote must come from: one function, so the two cannot differ. */
export const slideText = (record: SlideRecord): string =>
  [record.title, record.body, record.speakerNotes, ...record.imageCaptions]
    .filter((field) => /\S/.test(field))
    .join('\n');
