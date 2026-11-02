import type { SummaryOutcome } from '@cram/grounding';
import { baselineRow } from './metric-row';

/**
 * `summaryYield`: lectures with a stored summary over lectures. `summaryUnitYield`: stored units
 * over the units the generator drafted (`docs/adr/0009-explanation-answers.md` § Decision (o)).
 */
export const summaryRows = (outcomes: readonly SummaryOutcome[]) => {
  const stored = outcomes.flatMap((outcome) =>
    outcome.status === 'summarised' ? [outcome.summary.units.length] : [],
  );
  const drafted = outcomes.reduce((sum, { drafted: count }) => sum + count, 0);
  return {
    summaryYield: baselineRow(stored.length, outcomes.length, 'the course has no lecture'),
    summaryUnitYield: baselineRow(
      stored.reduce((sum, units) => sum + units, 0),
      drafted,
      'no summary call drafted a unit',
    ),
  };
};
