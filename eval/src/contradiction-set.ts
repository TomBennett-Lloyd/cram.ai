import type { ExplainStage } from '@cram/grounding';
import type { SourceId } from '@cram/shared';
import { z } from 'zod';
import { type AskedQuestion, namesExpected } from './asked-question';
import { firstForbiddenEntry, GoldenQuestion, inContradictionSet } from './golden-question';
import { absoluteFields, absoluteRow } from './metric-row';

export const ContradictionProblem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('no-expected-citation') }),
  z.strictObject({ kind: z.literal('answered-uncovered') }),
  z.strictObject({
    kind: z.literal('forbidden-text'),
    entry: z.string(),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal('unflagged-forbidden-text'),
    entry: z.string(),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal('model-failed'),
    stage: z.enum(['generate', 'verify']) satisfies z.ZodType<ExplainStage>,
  }),
]);
export type ContradictionProblem = z.infer<typeof ContradictionProblem>;

export const ContradictionFailure = z.strictObject({
  question: GoldenQuestion.shape.question,
  problems: z.array(ContradictionProblem).min(1),
});
export type ContradictionFailure = z.infer<typeof ContradictionFailure>;

/** The contradiction set's bar is `CLAUDE.md` § Hard constraints, "The slides win". */
export const ContradictionSetRow = absoluteRow(ContradictionFailure);
export type ContradictionSetRow = z.infer<typeof ContradictionSetRow>;

export const coverageProblems = (
  { question, result }: AskedQuestion,
  named: readonly SourceId[],
): ContradictionProblem[] => {
  if (question.expectedCitations.length === 0)
    return result.status === 'grounded' ? [{ kind: 'answered-uncovered' }] : [];
  const slides = result.status === 'grounded' ? result.slides : [];
  return named.some((id) => namesExpected(id, slides, question.expectedCitations))
    ? []
    : [{ kind: 'no-expected-citation' }];
};

/** `docs/adr/0005-evaluation-as-gate.md` § Decision (b)'s pass condition read over the explanation (`docs/adr/0009-explanation-answers.md` § Decision (o)). */
const problemsOf = (asked: AskedQuestion): ContradictionProblem[] => {
  const { question, result } = asked;
  if (result.status === 'model-failed') return [{ kind: 'model-failed', stage: result.stage }];
  const shown = result.status === 'grounded' ? result.explanation : undefined;
  const coverage = coverageProblems(asked, shown?.sources ?? []);
  const text = shown?.text ?? '';
  const entry = firstForbiddenEntry(text, question.mustNotContain);
  return entry === undefined ? coverage : [...coverage, { kind: 'forbidden-text', entry, text }];
};

export const contradictionSet = (asked: readonly AskedQuestion[]): ContradictionSetRow => {
  const items = asked.filter(({ question }) => inContradictionSet(question));
  const failures = items.flatMap((item): ContradictionFailure[] => {
    const problems = problemsOf(item);
    return problems.length === 0 ? [] : [{ question: item.question.question, problems }];
  });
  return ContradictionSetRow.parse(
    absoluteFields(items.length, failures, 'no golden question is in the contradiction set'),
  );
};
