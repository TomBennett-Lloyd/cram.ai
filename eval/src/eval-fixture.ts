import type { z } from 'zod';
import type { EvalCourse } from './audit';
import { DeckLecture, DeckSlide } from './deck';
import { FollowUpItem } from './follow-up';
import { GoldenQuestion } from './golden-question';
import { HandLabel } from './hand-label';
import { SentenceKindLabel } from './sentence-kind-label';
import { TopicLabel } from './topic-label';

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

export const followUp = (overrides: Partial<z.input<typeof FollowUpItem>> = {}): FollowUpItem =>
  FollowUpItem.parse({
    turns: [{ question: 'What shape are cells?', answer: 'Cells are square.' }],
    question: 'And how big are they?',
    standalone: 'How big are cells?',
    expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
    ...overrides,
  });

export const label = (overrides: Partial<z.input<typeof HandLabel>> = {}): HandLabel =>
  HandLabel.parse({
    text: 'Cells are square.',
    quotes: ['Cells are square.'],
    verdict: 'supported',
    ...overrides,
  });

export const kindLabel = (
  overrides: Partial<z.input<typeof SentenceKindLabel>> = {},
): SentenceKindLabel =>
  SentenceKindLabel.parse({
    sentence: 'So a cell is one compartment of the comb.',
    premises: [{ lectureId: 'l1', slideNo: 1 }],
    kind: 'interpretation',
    ...overrides,
  });

export const topicLabel = (overrides: Partial<z.input<typeof TopicLabel>> = {}): TopicLabel =>
  TopicLabel.parse({ lectureId: 'l1', slideNo: 1, tags: ['comb'], ...overrides });

export const course = (overrides: Partial<EvalCourse> = {}): EvalCourse => ({
  deck: [lecture('l1')],
  questions: [question()],
  followUps: [followUp()],
  labels: [label()],
  sentenceKinds: [kindLabel()],
  topicLabels: [topicLabel()],
  ...overrides,
});
