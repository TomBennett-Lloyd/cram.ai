import { z } from 'zod';
import { Citation, SourceId } from './citation';
import { NonBlankText } from './non-blank-text';

/**
 * What a sentence's `slides` are (`docs/adr/0009-explanation-answers.md` § Decision (a)): a
 * search's candidates in chat, the slides that entailed it, or none for a kept interpretation.
 */
export const SentenceStanding = z.enum(['attributed', 'entailed', 'interpretation']);
export type SentenceStanding = z.infer<typeof SentenceStanding>;

/** One sentence of an explanation (§ Decision (a)); `contradicts` best first (§ Amendments). */
export const AttributedSentence = z.strictObject({
  text: NonBlankText,
  slides: z.array(SourceId),
  contradicts: z.array(SourceId),
  standing: SentenceStanding,
});
export type AttributedSentence = z.infer<typeof AttributedSentence>;

/** The tutor's own words about the course, with its marked quotes and every slide it names in first-use order (§ Decision (a), (i)). */
export const Explanation = z.strictObject({
  text: NonBlankText,
  quotes: z.array(Citation),
  sentences: z.array(AttributedSentence).min(1),
  sources: z.array(SourceId).min(1),
});
export type Explanation = z.infer<typeof Explanation>;

export const ExplanationSurface = z.enum(['ask', 'revision-guide']);
export type ExplanationSurface = z.infer<typeof ExplanationSurface>;
