import { AskTurn, NonBlankText } from '@cram/shared';
import { z } from 'zod';
import { SlideRef } from './golden-question';

/** One `eval/follow-ups.jsonl` line (`docs/adr/0011-ask-conversation.md` § Decision (g)); `standalone` is the form a student could have typed, retrieval's ceiling. */
export const FollowUpItem = z.strictObject({
  turns: z.array(AskTurn).min(1),
  question: NonBlankText,
  standalone: NonBlankText,
  expectedCitations: z.array(SlideRef).min(1),
});
export type FollowUpItem = z.infer<typeof FollowUpItem>;
