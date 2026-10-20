import type { SlideRecord, SourceId } from '@cram/shared';

export interface RetrievedSlide {
  readonly sourceId: SourceId;
  readonly record: SlideRecord;
}

/** What the generator is shown and what a quote must come from: one function, so the two cannot differ. */
export const slideText = (record: SlideRecord): string =>
  [record.title, record.body, record.speakerNotes, ...record.imageCaptions].join('\n');
