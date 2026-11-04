import type { LectureKey } from '@cram/index';
import type { CourseId } from '@cram/shared';

/** `outcome` is a name, a kind or counts, never a message, which can quote a deck; a lecture is its `LectureKey`, never its id or title (`docs/adr/0004-storage.md` § Decision (b)): "470 yeah we should revise with an opaque key" (owner, 2026-11-04, #470). */
export interface LogEntry {
  readonly operation: string;
  readonly courseId: string;
  readonly lectureKey?: LectureKey;
  readonly outcome: string;
}

export type ServerLog = (entry: LogEntry) => void;

export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const lectureEntry = (
  operation: string,
  courseId: CourseId,
  lectureKey: LectureKey | undefined,
  outcome: string,
): LogEntry =>
  lectureKey === undefined
    ? { operation, courseId, outcome }
    : { operation, courseId, lectureKey, outcome };
