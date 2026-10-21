import {
  type ChatRequest,
  chatWireRequest,
  type EntailmentPair,
  type EntailmentResult,
  FakeGateway,
  type GeneratorReply,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
} from '@cram/gateway';
import { type Citation, type RetrievedSlide, SlideRecord, SourceId, type Unit } from '@cram/shared';
import type { DraftUnit } from './generate-units';
import type { EntailmentScores } from './nli-verdict';
import type { LineCitation } from './prompts/generation-prompt';

const pins = PROVISIONAL_DEFAULT_PINS;
const sampling = { temperature: 0, seed: 0 };

export const fakeGateway = (recordings: readonly Recording[]): FakeGateway =>
  new FakeGateway({ pins, sampling, recordings });

export const generatorRecording = <T>(
  request: ChatRequest<T>,
  reply: GeneratorReply,
): Recording => ({
  role: 'generator',
  pin: pins.generator,
  sampling,
  request: chatWireRequest(request),
  reply,
});

export const generatorReplies = <T>(request: ChatRequest<T>, value: unknown): Recording =>
  generatorRecording(request, { status: 'content', content: JSON.stringify(value) });

export const verifierRecording = (
  pairs: readonly EntailmentPair[],
  results: readonly EntailmentResult[],
): Recording => ({
  role: 'verifier',
  pin: pins.verifier,
  request: { pairs: [...pairs] },
  reply: { results: [...results] },
});

const scored = (scores: EntailmentScores): EntailmentResult => ({ status: 'scored', scores });

export const ENTAILED = scored({ entailment: 0.9, neutral: 0.05, contradiction: 0.05 });
export const NEUTRAL = scored({ entailment: 0.1, neutral: 0.8, contradiction: 0.1 });
export const CONTRADICTED = scored({ entailment: 0.05, neutral: 0.05, contradiction: 0.9 });
export const OVER_LENGTH: EntailmentResult = {
  status: 'over-length',
  inputTokens: 600,
  maxInputTokens: 512,
};

export const slide = (
  id: string,
  body: string,
  fields: Partial<SlideRecord> = {},
): RetrievedSlide => {
  const sourceId = SourceId.parse(id);
  const record = SlideRecord.parse({
    courseId: 'hollowmere',
    lectureId: 'l1',
    lectureTitle: 'The Hive',
    slideNo: 1,
    kind: 'content',
    title: '',
    body,
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
    ...fields,
  });
  return { sourceId, record };
};

export const cite = (id: string, quote: string): Citation => ({
  sourceId: SourceId.parse(id),
  quote,
});

export const line = (id: string, n: number): LineCitation => ({
  sourceId: SourceId.parse(id),
  line: n,
});

export const draft = (text: string, citations: readonly LineCitation[]): DraftUnit => ({
  text,
  citations: [...citations],
  kind: 'answer-sentence',
});

export const answer = (text: string, citations: readonly Citation[]): Unit => ({
  text,
  citations: [...citations],
  kind: 'answer-sentence',
});
