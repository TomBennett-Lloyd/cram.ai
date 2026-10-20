import { resolveCitations } from '@cram/grounding';
import { Unit } from '@cram/shared';
import { z } from 'zod';
import { type AskedQuestion, survivingUnits } from './asked-question';
import { GoldenQuestion } from './golden-question';
import { absoluteFields, absoluteRow } from './metric-row';

export const CitationFailure = z.strictObject({
  question: GoldenQuestion.shape.question,
  unit: Unit,
});
export type CitationFailure = z.infer<typeof CitationFailure>;

export const CitationValidityRow = absoluteRow(CitationFailure);
export type CitationValidityRow = z.infer<typeof CitationValidityRow>;

/**
 * Of the surviving units, those whose every citation resolves against that call's retrieved set,
 * by `resolveCitations` itself (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)).
 */
export const citationValidity = (asked: readonly AskedQuestion[]): CitationValidityRow => {
  const failures: CitationFailure[] = [];
  let units = 0;
  for (const { question, retrieved, result } of asked) {
    for (const unit of survivingUnits(result)) {
      units += 1;
      if (resolveCitations([unit], retrieved).withheld.length > 0)
        failures.push({ question: question.question, unit });
    }
  }
  return CitationValidityRow.parse(
    absoluteFields(units, failures, 'no unit survived for any question'),
  );
};
