import { NonBlankText, SlideRecord } from '@cram/shared';
import { z } from 'zod';

/** A slide named the way the deck names it, never by a minted `SourceId`. */
export const SlideRef = z.strictObject({
  lectureId: SlideRecord.shape.lectureId,
  slideNo: SlideRecord.shape.slideNo,
});
export type SlideRef = z.infer<typeof SlideRef>;

/**
 * One line of `eval/questions.jsonl`. The fields are the ones
 * `docs/adr/0005-evaluation-as-gate.md` § Decision (c) fixes, and no others.
 */
export const GoldenQuestion = z.strictObject({
  question: NonBlankText,
  expectedCitations: z.array(SlideRef),
  mustNotContain: z.array(NonBlankText),
});
export type GoldenQuestion = z.infer<typeof GoldenQuestion>;

/** Membership as `docs/adr/0005-evaluation-as-gate.md` § Decision (b) defines it. */
export const inContradictionSet = (item: GoldenQuestion): boolean =>
  item.mustNotContain.length > 0 || item.expectedCitations.length === 0;

const normaliseForMatch = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The first `mustNotContain` entry `text` contains, by § Decision (c)'s matching rule. */
export const firstForbiddenEntry = (
  text: string,
  mustNotContain: readonly string[],
): string | undefined => {
  const haystack = normaliseForMatch(text);
  return mustNotContain.find((entry) => haystack.includes(normaliseForMatch(entry)));
};
