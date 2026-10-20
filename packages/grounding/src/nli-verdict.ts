import type { EntailmentResult } from '@cram/gateway';
import type { Verdict } from '@cram/shared';

export type EntailmentScores = Extract<EntailmentResult, { status: 'scored' }>['scores'];

export interface NliThresholds {
  readonly entailedAt: number;
  readonly contradictedAt: number;
}

/** Tuned against `eval/labels/verifier.jsonl` by #47's runner; provisional until then (`docs/standards/architecture.md` rule 12). */
export const PROVISIONAL_NLI_THRESHOLDS: NliThresholds = { entailedAt: 0.5, contradictedAt: 0.5 };

type ClaimLabel = 'entailed' | 'neutral' | 'contradicted';

const claimLabel = (scores: EntailmentScores, thresholds: NliThresholds): ClaimLabel => {
  if (scores.contradiction >= thresholds.contradictedAt) return 'contradicted';
  if (scores.entailment >= thresholds.entailedAt) return 'entailed';
  return 'neutral';
};

/** One unit's verdict from its claims' scores; any contradicted claim withholds the whole unit. */
export const nliVerdict = (
  claims: readonly EntailmentScores[],
  thresholds: NliThresholds,
): Verdict => {
  const labels = claims.map((scores) => claimLabel(scores, thresholds));
  if (labels.includes('contradicted')) return 'unsupported';
  const entailed = labels.filter((label) => label === 'entailed').length;
  if (entailed === 0) return 'unsupported';
  return entailed === labels.length ? 'supported' : 'partial';
};
