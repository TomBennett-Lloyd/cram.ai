import type { GroundingStage } from '@cram/grounding';
import type { RetrievedSlide, Unit } from '@cram/shared';
import { z } from 'zod';
import { type AskedQuestion, survivingUnits } from './asked-question';
import {
  firstForbiddenEntry,
  GoldenQuestion,
  inContradictionSet,
  type SlideRef,
} from './golden-question';
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
    kind: z.literal('model-failed'),
    stage: z.enum(['generate', 'verify', 'rewrite']) satisfies z.ZodType<GroundingStage>,
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

const isExpected = (slide: RetrievedSlide, expected: readonly SlideRef[]): boolean =>
  expected.some(
    (ref) => ref.lectureId === slide.record.lectureId && ref.slideNo === slide.record.slideNo,
  );

const citesExpected = (
  unit: Unit,
  retrieved: readonly RetrievedSlide[],
  expected: readonly SlideRef[],
): boolean =>
  unit.citations.some((citation) =>
    retrieved.some((slide) => slide.sourceId === citation.sourceId && isExpected(slide, expected)),
  );

const forbidden = (units: readonly Unit[], mustNotContain: readonly string[]) =>
  units.flatMap((unit): ContradictionProblem[] => {
    const entry = firstForbiddenEntry(unit.text, mustNotContain);
    return entry === undefined ? [] : [{ kind: 'forbidden-text', entry, text: unit.text }];
  });

/** `docs/adr/0005-evaluation-as-gate.md` § Decision (b)'s pass condition; the withheld panel is exempt. */
const problemsOf = ({ question, retrieved, result }: AskedQuestion): ContradictionProblem[] => {
  if (result.status === 'model-failed') return [{ kind: 'model-failed', stage: result.stage }];
  const units = survivingUnits(result);
  const { expectedCitations, mustNotContain } = question;
  const coverage: ContradictionProblem[] =
    expectedCitations.length === 0
      ? units.length === 0
        ? []
        : [{ kind: 'answered-uncovered' }]
      : units.some((unit) => citesExpected(unit, retrieved, expectedCitations))
        ? []
        : [{ kind: 'no-expected-citation' }];
  return [...coverage, ...forbidden(units, mustNotContain)];
};

/** Of the set's items, those meeting § Decision (b)'s pass condition. */
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
