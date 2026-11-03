import { EMPTY_CONTEXT, type ExplainResult } from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import {
  type AttributedSentence,
  type Citation,
  Deck,
  type RetrievedSlide,
  SlideRecord,
} from '@cram/shared';
import type { z } from 'zod';
import type { AskedQuestion } from './asked-question';
import { question } from './eval-fixture';
import type { GoldenQuestion } from './golden-question';
import type { IndexedLecture } from './index-retriever';

export const record = (overrides: Partial<z.input<typeof SlideRecord>> = {}): SlideRecord =>
  SlideRecord.parse({
    courseId: 'hollowmere',
    lectureId: 'l1',
    lectureTitle: 'Lecture l1',
    slideNo: 1,
    kind: 'content',
    title: 'Comb',
    body: 'Cells are square.',
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
    ...overrides,
  });

export const indexedLecture = (
  lectureId: string,
  slides: readonly SlideRecord[] = [record({ lectureId })],
): IndexedLecture => ({
  deck: Deck.parse({
    lectureId,
    lectureTitle: `Lecture ${lectureId}`,
    mediaType: 'application/pdf',
    content: new TextEncoder().encode(`deck ${lectureId}`),
  }),
  slides,
});

export const retrieved = (slide: SlideRecord): RetrievedSlide => ({
  sourceId: sourceIdOf(slide),
  record: slide,
});

export const citing = (slide: SlideRecord, quote: string): Citation => ({
  sourceId: sourceIdOf(slide),
  quote,
});

export const sentence = (
  text: string,
  slides: readonly SlideRecord[],
  contradicts: readonly SlideRecord[] = [],
): AttributedSentence => ({
  text,
  slides: slides.map(sourceIdOf),
  contradicts: contradicts.map(sourceIdOf),
});

export const grounded = (
  sentences: readonly AttributedSentence[],
  slides: readonly SlideRecord[] = [record()],
  quotes: readonly Citation[] = [],
): ExplainResult => {
  const [first, ...rest] = [
    ...new Set([...sentences.flatMap((s) => s.slides), ...quotes.map((q) => q.sourceId)]),
  ];
  if (first === undefined) throw new Error('grounded: an explanation names a slide');
  return {
    status: 'grounded',
    explanation: {
      text: sentences.map(({ text }) => text).join(' '),
      quotes: [...quotes],
      sentences: [...sentences],
      sources: [first, ...rest],
    },
    withheld: [],
    slides: slides.map(retrieved),
    context: { ...EMPTY_CONTEXT, raw: slides.map(retrieved) },
  };
};

export const NOT_COVERED: ExplainResult = {
  status: 'not-covered',
  withheld: [],
  context: EMPTY_CONTEXT,
};

export const asked = (
  result: ExplainResult,
  slides: readonly SlideRecord[] = [record()],
  golden: GoldenQuestion = question(),
): AskedQuestion => ({ question: golden, retrieved: slides.map(retrieved), result });
