import { Citation, Unit, Verdict } from '@cram/shared';
import { z } from 'zod';

/** One `eval/labels/verifier.jsonl` line: `docs/adr/0005-evaluation-as-gate.md` § Decision (d). */
export const HandLabel = z.strictObject({
  text: Unit.shape.text,
  quotes: z.array(Citation.shape.quote).min(1),
  verdict: Verdict,
});
export type HandLabel = z.infer<typeof HandLabel>;
