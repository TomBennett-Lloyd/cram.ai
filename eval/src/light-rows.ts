import type { AttributedSentence, SourceId } from '@cram/shared';
import { z } from 'zod';
import { type AskedQuestion, namesExpected, shownSentences } from './asked-question';
import {
  ContradictionFailure,
  type ContradictionProblem,
  coverageProblems,
} from './contradiction-set';
import { firstForbiddenEntry, inContradictionSet } from './golden-question';
import { type BaselineRow, baselineRow, NotMeasurable, notMeasurable, Ratio } from './metric-row';

/** Never red (`docs/adr/0009-explanation-answers.md` § Decision (o)), so a baseline row that keeps its failures. */
export const LightSetRow = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('measured'),
      bar: z.literal('baseline'),
      ratio: Ratio,
      failures: z.array(ContradictionFailure),
    })
    .refine((row) => row.failures.length === row.ratio.denominator - row.ratio.numerator, {
      message: 'one failure per item not passed',
    }),
  NotMeasurable,
]);
export type LightSetRow = z.infer<typeof LightSetRow>;

export const attributionSet = ({ result }: AskedQuestion): readonly SourceId[] =>
  result.status === 'grounded'
    ? [
        ...result.explanation.sentences.flatMap(({ slides }) => slides),
        ...result.explanation.quotes.map(({ sourceId }) => sourceId),
      ]
    : [];

/** The mirror of `retrievalRecall` over each answer's attribution set. */
export const attributionRecall = (asked: readonly AskedQuestion[]): BaselineRow => {
  let expected = 0;
  let found = 0;
  for (const item of asked) {
    const named = attributionSet(item);
    const slides = item.result.status === 'grounded' ? item.result.slides : [];
    for (const ref of item.question.expectedCitations) {
      expected += 1;
      if (named.some((id) => namesExpected(id, slides, [ref]))) found += 1;
    }
  }
  return baselineRow(found, expected, 'no golden question names an expected slide');
};

export interface ForbiddenSentence {
  readonly index: number;
  readonly sentence: AttributedSentence;
  readonly entry: string;
}

export const forbiddenSentences = ({
  question,
  result,
}: AskedQuestion): readonly ForbiddenSentence[] =>
  shownSentences(result).flatMap((sentence, index) => {
    const entry = firstForbiddenEntry(sentence.text, question.mustNotContain);
    return entry === undefined ? [] : [{ index, sentence, entry }];
  });

const flagged = ({ question, result }: AskedQuestion, sentence: AttributedSentence): boolean => {
  const slides = result.status === 'grounded' ? result.slides : [];
  return sentence.contradicts.some((id) => namesExpected(id, slides, question.expectedCitations));
};

const lightProblems = (item: AskedQuestion): ContradictionProblem[] => {
  const { result } = item;
  if (result.status === 'model-failed') return [{ kind: 'model-failed', stage: result.stage }];
  const unflagged = forbiddenSentences(item)
    .filter(({ sentence }) => !flagged(item, sentence))
    .map(({ sentence, entry }): ContradictionProblem => ({
      kind: 'unflagged-forbidden-text',
      entry,
      text: sentence.text,
    }));
  return [...coverageProblems(item, attributionSet(item)), ...unflagged];
};

export const contradictionSetLight = (asked: readonly AskedQuestion[]): LightSetRow => {
  const items = asked.filter(({ question }) => inContradictionSet(question));
  if (items.length === 0) return notMeasurable('no golden question is in the contradiction set');
  const failures = items.flatMap((item): ContradictionFailure[] => {
    const problems = lightProblems(item);
    return problems.length === 0 ? [] : [{ question: item.question.question, problems }];
  });
  return LightSetRow.parse({
    status: 'measured',
    bar: 'baseline',
    ratio: { numerator: items.length - failures.length, denominator: items.length },
    failures,
  });
};

export const lightFlagRate = (asked: readonly AskedQuestion[]): BaselineRow => {
  const shown = asked
    .filter(({ question }) => inContradictionSet(question))
    .filter((item) => forbiddenSentences(item).length > 0);
  const marked = shown.filter((item) =>
    forbiddenSentences(item).every(({ sentence }) => flagged(item, sentence)),
  );
  return baselineRow(
    marked.length,
    shown.length,
    'no chat answer in the set showed a forbidden sentence',
  );
};
