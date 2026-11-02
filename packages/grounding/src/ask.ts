import type { RetrievedSlide } from '@cram/shared';
import { type ExplainDepth, type ExplainDeps, type ExplainResult, explain } from './explain';
import { VERIFICATION_DEPTH } from './verification-depth';

type AskDepth = Extract<ExplainDepth, { readonly depth: (typeof VERIFICATION_DEPTH)['ask'] }>;

/** What Ask's depth needs beside the gateway, so moving `VERIFICATION_DEPTH.ask` moves its callers' types. */
export type AskDeps = ExplainDeps & Omit<AskDepth, 'depth'>;

export const ask = (
  question: string,
  retrieved: readonly RetrievedSlide[],
  { gateway, thresholds, ...depth }: AskDeps,
): Promise<ExplainResult> =>
  explain(
    question,
    retrieved,
    { ...depth, depth: VERIFICATION_DEPTH.ask },
    { gateway, thresholds },
  );
