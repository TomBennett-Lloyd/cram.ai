import type { GeneratorReply } from './chat';

export interface GeneratorUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Client-measured milliseconds from sending the request; `usage` is `null` when the server sent none. */
export interface GeneratorTiming {
  readonly firstTokenMs: number;
  readonly lastTokenMs: number;
  readonly usage: GeneratorUsage | null;
}

/** A live call's reply beside its timing, which no recording stores (#138); `timing` is `null` with no content token. */
export interface TimedReply {
  readonly reply: GeneratorReply;
  readonly timing: GeneratorTiming | null;
}

/** A4's "tokens per second" (`docs/adr/0003-model-roles-and-backends.md` § Decision (k)), after the first token. */
export const decodeTokensPerSecond = (timing: GeneratorTiming): number | null => {
  if (timing.usage === null) return null;
  const decoded = timing.usage.completionTokens - 1;
  const intervalMs = timing.lastTokenMs - timing.firstTokenMs;
  return decoded > 0 && intervalMs > 0 ? (decoded * 1000) / intervalMs : null;
};
