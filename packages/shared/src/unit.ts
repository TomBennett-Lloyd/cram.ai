import { z } from 'zod';
import { Citation } from './citation';
import { NonBlankText } from './non-blank-text';

/** The text kinds `CLAUDE.md` § Hard constraints requires to be units. */
export const UnitKind = z.enum([
  'answer-sentence',
  'note-bullet',
  'exam-question',
  'gold-answer',
  'rubric-point',
]);
export type UnitKind = z.infer<typeof UnitKind>;

/**
 * The only vehicle for model-produced text the student reads
 * (`docs/adr/0001-grounding-architecture.md` § Decision (b)). An empty
 * `citations` parses so that resolution can withhold it as `dangling-citation`
 * (`docs/standards/grounding.md` rule 3).
 */
export const Unit = z.object({
  text: NonBlankText,
  citations: z.array(Citation),
  kind: UnitKind,
});
export type Unit = z.infer<typeof Unit>;
