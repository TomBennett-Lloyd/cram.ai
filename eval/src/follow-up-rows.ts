import { NonBlankText, type RetrievedSlide } from '@cram/shared';
import { z } from 'zod';
import type { AskedFollowUp } from './ask-follow-ups';
import { FollowUpItem } from './follow-up';
import { SlideRef } from './golden-question';
import { pooledAttributionRecall } from './light-rows';
import { type BaselineRow, NotMeasurable, notMeasurable, Ratio } from './metric-row';

export const FollowUpProblem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('missed-expected-slide'), ...SlideRef.shape }),
  z.strictObject({ kind: z.literal('model-failed') }),
]);
export type FollowUpProblem = z.infer<typeof FollowUpProblem>;

export const FollowUpFailure = z.strictObject({
  question: FollowUpItem.shape.question,
  rewrite: NonBlankText.nullable(),
  problems: z.array(FollowUpProblem).min(1),
});
export type FollowUpFailure = z.infer<typeof FollowUpFailure>;

/** Reported, never gated (`docs/adr/0011-ask-conversation.md` § Decision (g)). */
export const FollowUpSetRow = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('measured'),
      bar: z.literal('baseline'),
      ratio: Ratio,
      failures: z.array(FollowUpFailure),
    })
    .refine((row) => row.failures.length === row.ratio.denominator - row.ratio.numerator, {
      message: 'one failure per item not passed',
    }),
  NotMeasurable,
]);
export type FollowUpSetRow = z.infer<typeof FollowUpSetRow>;

const inTop = (slides: readonly RetrievedSlide[], k: number, ref: SlideRef): boolean =>
  slides
    .slice(0, k)
    .some(({ record }) => record.lectureId === ref.lectureId && record.slideNo === ref.slideNo);

const problemsOf = (asked: AskedFollowUp, k: number): FollowUpProblem[] =>
  asked.status === 'rewrite-failed'
    ? [{ kind: 'model-failed' }]
    : asked.item.expectedCitations
        .filter((ref) => inTop(asked.ceiling, k, ref) && !inTop(asked.retrieved, k, ref))
        .map((ref): FollowUpProblem => ({ kind: 'missed-expected-slide', ...ref }));

/** A follow-up passes when its rewrite's top `k` holds every expected slide its standalone form's top `k` holds. */
export const followUpRetrieval = (asked: readonly AskedFollowUp[], k: number): FollowUpSetRow => {
  if (asked.length === 0) return notMeasurable('no follow-up was asked');
  const failures = asked.flatMap((item): FollowUpFailure[] => {
    const problems = problemsOf(item, k);
    return problems.length === 0
      ? []
      : [
          {
            question: item.item.question,
            rewrite: item.status === 'asked' ? item.rewrite : null,
            problems,
          },
        ];
  });
  return FollowUpSetRow.parse({
    status: 'measured',
    bar: 'baseline',
    ratio: { numerator: asked.length - failures.length, denominator: asked.length },
    failures,
  });
};

/** `attributionRecall` over the follow-ups; a failed rewrite names none of its expected slides. */
export const followUpAttributionRecall = (asked: readonly AskedFollowUp[]): BaselineRow =>
  pooledAttributionRecall(
    asked.map((item) => ({
      expected: item.item.expectedCitations,
      result: item.status === 'asked' ? item.result : null,
    })),
    'no follow-up was asked',
  );
