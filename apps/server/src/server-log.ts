/** `outcome` is a name or a kind, never a message, which can quote a deck (`docs/adr/0004-storage.md` § Decision (b)). */
export interface LogEntry {
  readonly operation: string;
  readonly courseId: string;
  readonly outcome: string;
}

export type ServerLog = (entry: LogEntry) => void;

export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
