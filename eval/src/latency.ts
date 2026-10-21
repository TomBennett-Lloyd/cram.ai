import { z } from 'zod';
import { NotMeasurable, notMeasurable } from './metric-row';

const Milliseconds = z.number().nonnegative();

export const LatencySummary = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('measured'),
    samples: z.number().int().positive(),
    medianMs: Milliseconds,
    maxMs: Milliseconds,
  }),
  NotMeasurable,
]);
export type LatencySummary = z.infer<typeof LatencySummary>;

/** The median of an even count is the mean of its middle two. */
export const latencySummary = (
  durationsMs: readonly number[],
  emptyReason: string,
): LatencySummary => {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const upper = sorted[Math.floor(sorted.length / 2)];
  const lower = sorted[Math.ceil(sorted.length / 2) - 1];
  const max = sorted.at(-1);
  if (upper === undefined || lower === undefined || max === undefined)
    return notMeasurable(emptyReason);
  return LatencySummary.parse({
    status: 'measured',
    samples: sorted.length,
    medianMs: (lower + upper) / 2,
    maxMs: max,
  });
};

/** A monotonic millisecond clock, injected so the core reads no clock of its own (`docs/standards/architecture.md` rule 3). */
export type Clock = () => number;

/** Runs `call`, handing its duration to `record` whether it resolves or rejects. */
export const timed = async <T>(
  clock: Clock,
  record: (ms: number) => void,
  call: () => Promise<T>,
) => {
  const start = clock();
  try {
    return await call();
  } finally {
    record(clock() - start);
  }
};
