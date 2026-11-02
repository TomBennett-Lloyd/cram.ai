import { z } from 'zod';
import { Citation, SourceId } from './citation';
import { NonBlankText } from './non-blank-text';

/**
 * One sentence of an explanation (`docs/adr/0009-explanation-answers.md` § Decision (a)): `slides`
 * are the candidates a search found (light) or the slides that entailed it (deep); `contradicts`
 * the slides scored as contradicting it, best first.
 */
export const AttributedSentence = z.strictObject({
  text: NonBlankText,
  slides: z.array(SourceId),
  contradicts: z.array(SourceId),
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
