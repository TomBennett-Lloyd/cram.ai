import type { ModelGateway } from '@cram/gateway';
import type { Verdict } from '@cram/shared';
import { z } from 'zod';
import { splitClaims } from './claims';
import type { ModelFailure } from './model-failure';
import { type EntailmentScores, nliVerdict, type NliThresholds } from './nli-verdict';
import { verifierRequest } from './prompts/verifier-prompt';
import type { VerifierInput } from './verifier-input';

export const VerifierStrategy = z.enum(['nli', 'llm', 'nli-then-llm']);
export type VerifierStrategy = z.infer<typeof VerifierStrategy>;

/** The cross-encoder first, the LLM path a second opinion (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)). */
export const PROVISIONAL_VERIFIER_STRATEGY: VerifierStrategy = 'nli-then-llm';

export interface VerifyDeps {
  readonly gateway: Pick<ModelGateway, 'generator' | 'verifier'>;
  readonly strategy: VerifierStrategy;
  readonly thresholds: NliThresholds;
}

export type VerifyOutcome =
  | { readonly status: 'verified'; readonly verdict: Verdict }
  | { readonly status: 'model-failed'; readonly failure: ModelFailure };

type NliOutcome =
  { readonly status: 'judged'; readonly verdict: Verdict } | { readonly status: 'over-length' };

const verified = (verdict: Verdict): VerifyOutcome => ({ status: 'verified', verdict });

const nliJudgement = async (input: VerifierInput, deps: VerifyDeps): Promise<NliOutcome> => {
  const premise = input.quotes.join('\n');
  const claims = splitClaims(input.text);
  const results = await deps.gateway.verifier.entail({
    pairs: claims.map((hypothesis) => ({ premise, hypothesis })),
  });
  if (results.length !== claims.length) {
    throw new Error(
      `verifier returned ${String(results.length)} results for ${String(claims.length)} pairs`,
    );
  }
  const scores: EntailmentScores[] = [];
  for (const result of results) {
    if (result.status === 'over-length') return { status: 'over-length' };
    scores.push(result.scores);
  }
  return { status: 'judged', verdict: nliVerdict(scores, deps.thresholds) };
};

const llmVerdict = async (input: VerifierInput, deps: VerifyDeps): Promise<VerifyOutcome> => {
  const result = await deps.gateway.generator.chat(verifierRequest(input));
  return result.status === 'completed'
    ? verified(result.value.verdict)
    : { status: 'model-failed', failure: result };
};

/** An over-length input is never truncated: the second opinion judges it, or it fails closed (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)). */
export const verifyStatement = async (
  input: VerifierInput,
  deps: VerifyDeps,
): Promise<VerifyOutcome> => {
  if (deps.strategy === 'llm') return llmVerdict(input, deps);
  const secondOpinion = deps.strategy === 'nli-then-llm';
  const nli = await nliJudgement(input, deps);
  if (nli.status === 'over-length')
    return secondOpinion ? llmVerdict(input, deps) : verified('unsupported');
  return nli.verdict === 'partial' && secondOpinion
    ? llmVerdict(input, deps)
    : verified(nli.verdict);
};
