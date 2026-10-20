import { NonBlankText } from '@cram/shared';
import { z } from 'zod';

const Count = z.number().int().nonnegative();

/** A numerator over a positive denominator (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)). */
export const Ratio = z
  .strictObject({ numerator: Count, denominator: Count.positive() })
  .refine((ratio) => ratio.numerator <= ratio.denominator, {
    message: 'numerator exceeds denominator',
  });
export type Ratio = z.infer<typeof Ratio>;

export const NotMeasurable = z.strictObject({
  status: z.literal('not-measurable'),
  reason: NonBlankText,
});
export type NotMeasurable = z.infer<typeof NotMeasurable>;

export const notMeasurable = (reason: string): NotMeasurable =>
  NotMeasurable.parse({ status: 'not-measurable', reason });

/** A row whose bar is the newest same-class report's figure (§ Decision (f)). */
export const BaselineRow = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('measured'), bar: z.literal('baseline'), ratio: Ratio }),
  NotMeasurable,
]);
export type BaselineRow = z.infer<typeof BaselineRow>;

/** `not-measurable` with `emptyReason` when nothing was counted. */
export const baselineRow = (
  numerator: number,
  denominator: number,
  emptyReason: string,
): BaselineRow =>
  denominator === 0
    ? notMeasurable(emptyReason)
    : BaselineRow.parse({ status: 'measured', bar: 'baseline', ratio: { numerator, denominator } });

/** A row that is red on any failure, one entry per failed item (§ Decision (f)). */
export const absoluteRow = <F extends z.ZodType>(failure: F) =>
  z.discriminatedUnion('status', [
    z
      .strictObject({
        status: z.literal('measured'),
        bar: z.literal('absolute'),
        ratio: Ratio,
        failures: z.array(failure),
      })
      .refine((row) => row.failures.length === row.ratio.denominator - row.ratio.numerator, {
        message: 'one failure per item not passed',
      }),
    NotMeasurable,
  ]);

/** An absolute row's fields before its schema parses them; no item counted is `not-measurable`. */
export const absoluteFields = <F>(items: number, failures: readonly F[], emptyReason: string) =>
  items === 0
    ? notMeasurable(emptyReason)
    : {
        status: 'measured' as const,
        bar: 'absolute' as const,
        ratio: { numerator: items - failures.length, denominator: items },
        failures,
      };

type AbsoluteOutcome =
  NotMeasurable | { readonly status: 'measured'; readonly failures: readonly unknown[] };

/** A measured row with no failure; `not-measurable` is never a pass. */
export const passed = (row: AbsoluteOutcome): boolean =>
  row.status === 'measured' && row.failures.length === 0;
