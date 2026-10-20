import type { GroundingResult } from '@cram/grounding';
import type { RetrievedSlide, Unit } from '@cram/shared';
import type { GoldenQuestion } from './golden-question';

/** One golden question as the runner asked it: what retrieval returned and what Ask made of it. */
export interface AskedQuestion {
  readonly question: GoldenQuestion;
  readonly retrieved: readonly RetrievedSlide[];
  readonly result: GroundingResult;
}

/** The units not withheld (`docs/adr/0005-evaluation-as-gate.md` § Decision (b)). */
export const survivingUnits = (result: GroundingResult): readonly Unit[] =>
  result.status === 'grounded' ? result.shown : [];
