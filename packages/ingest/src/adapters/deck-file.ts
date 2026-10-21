import { createHash } from 'node:crypto';
import {
  SourceHash,
  type CourseId,
  type LectureId,
  type SlideImage,
  type SlideRecord,
} from '@cram/shared';

/** An uploaded deck as every format adapter receives it; a rebuild passes the `storedTitle` (#299). */
export interface DeckFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly storedTitle?: string;
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
}

/** `Reason` is the adapter's own vocabulary. `images` holds one per slide the adapter renders; PPTX renders none yet (#169). */
export type IngestResult<Reason extends string> =
  | {
      readonly status: 'ingested';
      readonly slides: readonly SlideRecord[];
      readonly images: readonly SlideImage[];
    }
  | {
      readonly status: 'unreadable';
      readonly fileName: string;
      readonly reason: Reason;
      readonly detail: string;
    };

export const sourceHashOf = (bytes: Uint8Array): SourceHash =>
  SourceHash.parse(createHash('sha256').update(bytes).digest('hex'));
