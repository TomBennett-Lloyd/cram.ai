import {
  contextPremises,
  explanationRequest,
  PROMPT_TOKEN_BUDGET,
  requestTokens,
} from '@cram/grounding';
import { z } from 'zod';
import { type AskedQuestion, shownSentences } from './asked-question';
import { type BaselineRow, baselineRow, NotMeasurable, notMeasurable } from './metric-row';

const Tokens = z.number().int().nonnegative();

/** The largest explanation prompt a run sent, by `estimateTokens`, beside the budget it was assembled under. */
export const PromptTokens = z.strictObject({
  budget: Tokens.positive(),
  estimate: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('measured'),
      samples: Tokens.positive(),
      maxTokens: Tokens,
    }),
    NotMeasurable,
  ]),
});
export type PromptTokens = z.infer<typeof PromptTokens>;

const assembled = (asked: readonly AskedQuestion[]) =>
  asked.filter(({ result }) => result.context.raw.length > 0);

/** `contextOverflow`: of the asks that assembled a prompt, those whose prompt left something out (`docs/adr/0009-explanation-answers.md` § Decision (o)). */
export const contextOverflow = (asked: readonly AskedQuestion[]): BaselineRow => {
  const prompted = assembled(asked);
  const over = prompted.filter(({ result }) => result.context.leftOut.length > 0);
  return baselineRow(over.length, prompted.length, 'no question retrieved a slide');
};

/** `sourceCoverage`: of the slides each prompt loaded, raw or cited by a loaded unit, those a shown sentence credits; pooled. */
export const sourceCoverage = (asked: readonly AskedQuestion[]): BaselineRow => {
  let loaded = 0;
  let credited = 0;
  for (const { result } of asked) {
    const held = new Set(contextPremises(result.context).flatMap(({ sources }) => sources));
    const named = new Set(shownSentences(result).flatMap(({ slides }) => slides));
    loaded += held.size;
    credited += [...held].filter((sourceId) => named.has(sourceId)).length;
  }
  return baselineRow(credited, loaded, 'no prompt loaded a slide');
};

export const promptTokens = (asked: readonly AskedQuestion[]): PromptTokens => {
  const sizes = assembled(asked).map(({ question, result }) =>
    requestTokens(explanationRequest(question.question, result.context)),
  );
  return PromptTokens.parse({
    budget: PROMPT_TOKEN_BUDGET,
    estimate:
      sizes.length === 0
        ? notMeasurable('no question retrieved a slide')
        : { status: 'measured', samples: sizes.length, maxTokens: Math.max(...sizes) },
  });
};
