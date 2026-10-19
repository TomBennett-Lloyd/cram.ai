import { Citation, Unit, Verdict } from '@cram/shared';
import { z } from 'zod';

/**
 * One line of `eval/labels/verifier.jsonl`: a unit's text and its quotes, labelled
 * with the verdict a careful reader gives (`docs/adr/0005-evaluation-as-gate.md`
 * § Decision (d), the verifier precision / recall row).
 */
export const HandLabel = z.strictObject({
  text: Unit.shape.text,
  quotes: z.array(Citation.shape.quote).min(1),
  verdict: Verdict,
});
export type HandLabel = z.infer<typeof HandLabel>;
