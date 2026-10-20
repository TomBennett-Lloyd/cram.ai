import type { PartialPolicy } from '@cram/shared';
import { ground, type GroundingResult } from './ground';
import type { RetrievedSlide } from './slide-text';
import type { VerifyDeps } from './verify';

/** Ask's choice from the closed policy set (`docs/adr/0001-grounding-architecture.md` § Consequences); argued on #13. */
export const ASK_PARTIAL_POLICY: PartialPolicy = 'drop';

export const ask = (
  question: string,
  retrieved: readonly RetrievedSlide[],
  deps: VerifyDeps,
): Promise<GroundingResult> =>
  ground({ kind: 'answer-sentence', question }, retrieved, {
    ...deps,
    partialPolicy: ASK_PARTIAL_POLICY,
  });
