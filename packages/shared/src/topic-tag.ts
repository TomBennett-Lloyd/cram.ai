import { z } from 'zod';

/** A fact's topic tag (`docs/plan.md` §3.2): refused when blank or untrimmed, never normalised. */
export const TopicTag = z
  .string()
  .regex(/^\S(?:[\s\S]*\S)?$/)
  .brand<'TopicTag'>();
export type TopicTag = z.infer<typeof TopicTag>;

export const TopicOrigin = z.enum(['tagger', 'student']);
export type TopicOrigin = z.infer<typeof TopicOrigin>;
