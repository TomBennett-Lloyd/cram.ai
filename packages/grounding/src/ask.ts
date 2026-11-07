import { type AskRequest, VERIFICATION_DEPTH } from '@cram/shared';
import {
  type ExplainDepth,
  type ExplainDeps,
  type ExplainResult,
  type ExplainSources,
  explain,
} from './explain';

type AskDepth = Extract<ExplainDepth, { readonly depth: (typeof VERIFICATION_DEPTH)['ask'] }>;

/** What Ask's depth needs beside the gateway, so moving `VERIFICATION_DEPTH.ask` moves its callers' types. */
export type AskDeps = ExplainDeps & Omit<AskDepth, 'depth'>;

export const ask = (
  asked: AskRequest,
  sources: ExplainSources,
  { gateway, thresholds, ...depth }: AskDeps,
): Promise<ExplainResult> =>
  explain(asked, sources, { ...depth, depth: VERIFICATION_DEPTH.ask }, { gateway, thresholds });
