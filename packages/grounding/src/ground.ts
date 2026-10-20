import type { PartialPolicy, Unit, Verdict, WithheldUnit } from '@cram/shared';
import { generateUnits } from './generate-units';
import type { ModelFailure } from './model-failure';
import type { GenerationTask } from './prompts/generation-prompt';
import { rewriteRequest } from './prompts/rewrite-prompt';
import { type ResolvedUnit, resolveCitations } from './resolve-citations';
import type { RetrievedSlide } from './slide-text';
import { type VerifyDeps, verifyStatement } from './verify';

export interface GroundingDeps extends VerifyDeps {
  readonly partialPolicy: PartialPolicy;
}

export type GroundingStage = 'generate' | 'verify' | 'rewrite';

export type GroundingResult =
  | {
      readonly status: 'grounded';
      readonly shown: readonly [Unit, ...Unit[]];
      readonly withheld: readonly WithheldUnit[];
    }
  | { readonly status: 'not-covered'; readonly withheld: readonly WithheldUnit[] }
  | {
      readonly status: 'model-failed';
      readonly stage: GroundingStage;
      readonly failure: ModelFailure;
    };

type Settled =
  | { readonly status: 'shown'; readonly unit: Unit }
  | { readonly status: 'withheld'; readonly entry: WithheldUnit }
  | {
      readonly status: 'model-failed';
      readonly stage: GroundingStage;
      readonly failure: ModelFailure;
    };

const byVerdict = (unit: Unit, verdict: Verdict, policy: PartialPolicy): Settled => {
  switch (verdict) {
    case 'supported':
      return { status: 'shown', unit };
    case 'unsupported':
      return { status: 'withheld', entry: { reason: 'unsupported', unit } };
    case 'partial':
      return { status: 'withheld', entry: { reason: 'partial', policy, unit } };
  }
};

/** `partial` under `rewrite-once`: one rewrite against the same quotes, re-verified (`docs/standards/grounding.md` rule 4). */
const settle = async ({ unit, quotes }: ResolvedUnit, deps: GroundingDeps): Promise<Settled> => {
  const first = await verifyStatement({ text: unit.text, quotes }, deps);
  if (first.status === 'model-failed') return { ...first, stage: 'verify' };
  if (first.verdict !== 'partial' || deps.partialPolicy === 'drop') {
    return byVerdict(unit, first.verdict, deps.partialPolicy);
  }
  const rewrite = await deps.gateway.generator.chat(rewriteRequest({ text: unit.text, quotes }));
  if (rewrite.status !== 'completed')
    return { status: 'model-failed', stage: 'rewrite', failure: rewrite };
  const rewritten = { ...unit, text: rewrite.value.text };
  const second = await verifyStatement({ text: rewritten.text, quotes }, deps);
  if (second.status === 'model-failed') return { ...second, stage: 'verify' };
  return byVerdict(rewritten, second.verdict, deps.partialPolicy);
};

/** Generate, resolve, verify, report (`docs/standards/grounding.md` rule 2); no surviving unit is `not-covered`, a result (rule 5). */
export const ground = async (
  task: GenerationTask,
  retrieved: readonly RetrievedSlide[],
  deps: GroundingDeps,
): Promise<GroundingResult> => {
  if (retrieved.length === 0) return { status: 'not-covered', withheld: [] };
  const generation = await generateUnits(task, retrieved, deps.gateway.generator);
  if (generation.status === 'model-failed') return { ...generation, stage: 'generate' };
  const resolution = resolveCitations(generation.units, retrieved);
  const withheld = [...resolution.withheld];
  const shown: Unit[] = [];
  for (const resolved of resolution.resolved) {
    const settled = await settle(resolved, deps);
    if (settled.status === 'model-failed') return settled;
    if (settled.status === 'shown') shown.push(settled.unit);
    else withheld.push(settled.entry);
  }
  const [first, ...rest] = shown;
  return first === undefined
    ? { status: 'not-covered', withheld }
    : { status: 'grounded', shown: [first, ...rest], withheld };
};
