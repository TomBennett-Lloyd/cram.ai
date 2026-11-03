import type { LectureId } from '@cram/shared';

/** `outcome` is a name, a kind or counts, never a message, which can quote a deck, and a lecture is its id, never its title (`docs/adr/0004-storage.md` § Decision (b), #470). */
export interface LogEntry {
  readonly operation: string;
  readonly courseId: string;
  readonly lectureId?: LectureId;
  readonly outcome: string;
}

export type ServerLog = (entry: LogEntry) => void;

export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
