import { z } from 'zod';
import { Citation } from './citation';
import { NonBlankText } from './non-blank-text';

/** The reported kinds (`docs/adr/0009-explanation-answers.md` § Decision (a)). */
export const UnitKind = z.enum(['lecture-summary', 'exam-question', 'gold-answer', 'rubric-point']);
export type UnitKind = z.infer<typeof UnitKind>;

/**
 * A reported claim (`docs/adr/0009-explanation-answers.md` § Decision (a)); an empty `citations` parses so resolution can withhold it as `dangling-citation` (`docs/standards/grounding.md` rule 3).
 */
export const Unit = z.object({
  text: NonBlankText,
  citations: z.array(Citation),
  kind: UnitKind,
});
export type Unit = z.infer<typeof Unit>;
