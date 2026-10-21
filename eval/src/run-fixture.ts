import type { GroundingResult } from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import { type Citation, Deck, type RetrievedSlide, SlideRecord, type Unit } from '@cram/shared';
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

export const unit = (text: string, citations: readonly Citation[]): Unit => ({
  text,
  citations: [...citations],
  kind: 'answer-sentence',
});

export const grounded = (...shown: [Unit, ...Unit[]]): GroundingResult => ({
  status: 'grounded',
  shown,
  withheld: [],
});

export const NOT_COVERED: GroundingResult = { status: 'not-covered', withheld: [] };

export const asked = (
  result: GroundingResult,
  slides: readonly SlideRecord[] = [record()],
  golden: GoldenQuestion = question(),
): AskedQuestion => ({ question: golden, retrieved: slides.map(retrieved), result });
