import { createHash } from 'node:crypto';
import { SourceHash, type CourseId, type LectureId } from '@cram/shared';
import type { IngestedSlide } from '../page-text';

/** An uploaded deck as every format adapter receives it. */
export interface DeckFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
}

/** `Reason` is the adapter's own vocabulary for a deck its bytes cannot yield. */
export type IngestResult<Reason extends string> =
  | { readonly status: 'ingested'; readonly slides: readonly IngestedSlide[] }
  | {
      readonly status: 'unreadable';
      readonly fileName: string;
      readonly reason: Reason;
      readonly detail: string;
    };

export const sourceHashOf = (bytes: Uint8Array): SourceHash =>
  SourceHash.parse(createHash('sha256').update(bytes).digest('hex'));
