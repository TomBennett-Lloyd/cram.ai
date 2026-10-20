import type { z } from 'zod';
import type { EvalCourse } from './audit';
import { DeckLecture, DeckSlide } from './deck';
import { GoldenQuestion } from './golden-question';
import { HandLabel } from './hand-label';

export const slide = (overrides: Partial<z.input<typeof DeckSlide>> = {}): DeckSlide =>
  DeckSlide.parse({ slideNo: 1, title: 'Comb', body: ['Cells are square.'], ...overrides });

export const lecture = (lectureId: string, slides: readonly DeckSlide[] = [slide()]): DeckLecture =>
  DeckLecture.parse({ lectureId, lectureTitle: `Lecture ${lectureId}`, slides });

export const question = (overrides: Partial<z.input<typeof GoldenQuestion>> = {}): GoldenQuestion =>
  GoldenQuestion.parse({
    question: 'What shape are cells?',
    expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
    mustNotContain: [],
    ...overrides,
  });

export const label = (overrides: Partial<z.input<typeof HandLabel>> = {}): HandLabel =>
  HandLabel.parse({
    text: 'Cells are square.',
    quotes: ['Cells are square.'],
    verdict: 'supported',
    ...overrides,
  });

export const course = (overrides: Partial<EvalCourse> = {}): EvalCourse => ({
  deck: [lecture('l1')],
  questions: [question()],
  labels: [label()],
  ...overrides,
});
