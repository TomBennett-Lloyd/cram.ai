import { SentenceKind } from '@cram/grounding';
import { NonBlankText } from '@cram/shared';
import { z } from 'zod';
import { SlideRef } from './golden-question';

/** One `eval/labels/sentence-kind.jsonl` line (`docs/adr/0009-explanation-answers.md` § Decision (o)); each premise is a whole slide, as the sentence-kind judge is shown it. */
export const SentenceKindLabel = z.strictObject({
  sentence: NonBlankText,
  premises: z.array(SlideRef).min(1),
  kind: SentenceKind,
});
export type SentenceKindLabel = z.infer<typeof SentenceKindLabel>;
