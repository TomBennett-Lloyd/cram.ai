import { createHash } from 'node:crypto';
import { SourceHash, type CourseId, type LectureId, type SlideRecord } from '@cram/shared';

/** An uploaded deck as every format adapter receives it. */
export interface DeckFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
}

/** `Reason` is the adapter's own vocabulary. */
export type IngestResult<Reason extends string> =
  | { readonly status: 'ingested'; readonly slides: readonly SlideRecord[] }
  | {
      readonly status: 'unreadable';
      readonly fileName: string;
      readonly reason: Reason;
      readonly detail: string;
    };

export const sourceHashOf = (bytes: Uint8Array): SourceHash =>
  SourceHash.parse(createHash('sha256').update(bytes).digest('hex'));
