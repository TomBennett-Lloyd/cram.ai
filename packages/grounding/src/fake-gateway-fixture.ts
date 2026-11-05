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
import type { SearchSentence } from './explain';
import type { EntailmentScores } from './nli-verdict';
import { type LineCitation, SlideLineNo } from './prompts/generation-prompt';
import { type SentenceKind, sentenceKindRequest } from './prompts/sentence-kind-prompt';
import { scoredPremises, slidePremise } from './premise';
import { resolveCitations } from './resolve-citations';
import { slideText } from './slide-text';

const pins = PROVISIONAL_DEFAULT_PINS;
const sampling = { temperature: 0, seed: 0 };
const maxOutputTokens = 512;

export const fakeGateway = (recordings: readonly Recording[]): FakeGateway =>
  new FakeGateway({ pins, sampling, maxOutputTokens, recordings });

export const generatorRecording = <T>(
  request: ChatRequest<T>,
  reply: GeneratorReply,
): Recording => ({
  role: 'generator',
  pin: pins.generator,
  sampling,
  maxOutputTokens,
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
  line: SlideLineNo.parse(n),
});

export const draft = (text: string, citations: readonly LineCitation[]): DraftUnit => ({
  text,
  citations: [...citations],
  kind: 'lecture-summary',
});

export const emittedCitation = (
  citation: Citation,
  slides: readonly RetrievedSlide[],
): LineCitation => {
  for (let n = 1; ; n += 1) {
    const emitted = line(citation.sourceId, n);
    const [looked] = resolveCitations([draft('', [emitted])], slides).resolved;
    if (looked === undefined)
      throw new Error(`fixture: "${citation.quote}" is no line of ${citation.sourceId}`);
    if (looked.quotes[0] === citation.quote) return emitted;
  }
};

export const answer = (text: string, citations: readonly Citation[]): Unit => ({
  text,
  citations: [...citations],
  kind: 'lecture-summary',
});

const scoredTexts = (slide: RetrievedSlide): readonly string[] =>
  scoredPremises([slidePremise(slide)]).map(({ text }) => text);

export const pairsOf = (hypothesis: string, slides: readonly RetrievedSlide[]): EntailmentPair[] =>
  slides.flatMap((slide) => scoredTexts(slide).map((premise) => ({ premise, hypothesis })));

export const bySlide = (
  slides: readonly RetrievedSlide[],
  results: readonly EntailmentResult[],
): EntailmentResult[] => {
  if (results.length !== slides.length)
    throw new Error(
      `bySlide: ${String(results.length)} results for ${String(slides.length)} slides`,
    );
  return slides.flatMap((slide, at) => {
    const result = results[at];
    return result === undefined ? [] : scoredTexts(slide).map(() => result);
  });
};

export const scriptedSearch = (
  candidates: Readonly<Record<string, readonly RetrievedSlide[]>>,
): { readonly search: SearchSentence; readonly asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    search: (sentence) => {
      asked.push(sentence);
      return Promise.resolve(candidates[sentence] ?? []);
    },
  };
};

export const kindsRecording = (
  sentences: readonly string[],
  slides: readonly RetrievedSlide[],
  reply: readonly SentenceKind[] | GeneratorReply,
): Recording => {
  const request = sentenceKindRequest(
    sentences,
    slides.map((slide) => slideText(slide.record)),
  );
  return 'status' in reply
    ? generatorRecording(request, reply)
    : generatorReplies(request, { kinds: reply });
};
