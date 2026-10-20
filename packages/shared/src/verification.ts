import { z } from 'zod';

/** Vocabularies owned by `docs/adr/0001-grounding-architecture.md` § Decision (d). */
export const Verdict = z.enum(['supported', 'partial', 'unsupported']);
export type Verdict = z.infer<typeof Verdict>;

export const PartialPolicy = z.enum(['drop', 'rewrite-once']);
export type PartialPolicy = z.infer<typeof PartialPolicy>;

/** Why a unit is withheld (`docs/standards/grounding.md` rule 7); its ledger: `.claude/ledgers/withheld-reasons.ledger`. */
export const WithheldReason = z.enum([
  'dangling-citation',
  ...Verdict.exclude(['supported']).options,
]);
export type WithheldReason = z.infer<typeof WithheldReason>;
