import { TopicTag } from '@cram/shared';
import { z } from 'zod';
import { SlideRef } from './golden-question';

/** One `eval/labels/topics.jsonl` line (#426): a slide, and the topics a student would look for it by. */
export const TopicLabel = z.strictObject({
  ...SlideRef.shape,
  tags: z.array(TopicTag).min(1),
});
export type TopicLabel = z.infer<typeof TopicLabel>;
