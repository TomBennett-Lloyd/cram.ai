import type { ExplanationSurface, VerificationDepth } from '@cram/shared';

/** Each surface's depth (`docs/adr/0009-explanation-answers.md` § Decision (f)); its ledger: `.claude/ledgers/verification-depth.ledger`. */
export const VERIFICATION_DEPTH = {
  ask: 'light',
  'revision-guide': 'deep',
} as const satisfies Readonly<Record<ExplanationSurface, VerificationDepth>>;
