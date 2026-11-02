import type { ModelGateway } from '@cram/gateway';
import {
  type AttributedSentence,
  type Citation,
  type Explanation,
  quoteSpan,
  type RetrievedSlide,
  type WithheldSentence,
} from '@cram/shared';
import { attributeSentences, quotesIn, sourcesOf, uniqueSlides } from './attribute-sentences';
import { type ClaimSpan, claimSpans, spansOf } from './claims';
import { markContradictions } from './mark-contradictions';
import type { ModelFailure } from './model-failure';
import type { NliThresholds } from './nli-verdict';
import { explanationRequest } from './prompts/explanation-prompt';
import { resolveQuotes } from './resolve-quotes';
import { verifyExplanation } from './verify-explanation';

/** A course-wide search over one sentence, injected because this package does not depend on `@cram/index`. */
export type SearchSentence = (sentence: string) => Promise<readonly RetrievedSlide[]>;

export type ExplainDepth =
  | { readonly depth: 'light'; readonly searchSentence: SearchSentence }
  | { readonly depth: 'deep'; readonly secondOpinion: boolean };

export interface ExplainDeps {
  readonly gateway: Pick<ModelGateway, 'generator' | 'verifier'>;
  readonly thresholds: NliThresholds;
}

export type ExplainStage = 'generate' | 'verify';

/** `slides` is every slide the explanation names: the retrieved set, then each sentence's candidates. */
export type ExplainResult =
  | {
      readonly status: 'grounded';
      readonly explanation: Explanation;
      readonly withheld: readonly WithheldSentence[];
      readonly slides: readonly RetrievedSlide[];
    }
  | { readonly status: 'not-covered'; readonly withheld: readonly WithheldSentence[] }
  | {
      readonly status: 'model-failed';
      readonly stage: ExplainStage;
      readonly failure: ModelFailure;
    };

interface Drafted {
  readonly text: string;
  readonly quotes: readonly Citation[];
  readonly withheld: readonly WithheldSentence[];
}

type Retrieved = readonly [RetrievedSlide, ...RetrievedSlide[]];

const shown = (
  { text, quotes, withheld }: Drafted,
  sentences: readonly AttributedSentence[],
  spans: readonly ClaimSpan[],
  slides: readonly RetrievedSlide[],
  [head, ...tail]: Retrieved,
): ExplainResult => {
  const sources = sourcesOf(
    sentences.map((sentence, index) => {
      const span = spans[index];
      const quoted = span === undefined ? [] : quotesIn(text, span, quotes);
      return [...sentence.slides, ...quoted.map(({ sourceId }) => sourceId)];
    }),
  );
  const [named, ...more] = sources;
  const [first, ...rest] =
    named === undefined
      ? [head.sourceId, ...tail.map(({ sourceId }) => sourceId)]
      : [named, ...more];
  return {
    status: 'grounded',
    explanation: {
      text,
      quotes: [...quotes],
      sentences: [...sentences],
      sources: [first, ...rest],
    },
    withheld,
    slides,
  };
};

const light = async (
  drafted: Drafted,
  retrieved: Retrieved,
  searchSentence: SearchSentence,
  deps: ExplainDeps,
): Promise<ExplainResult> => {
  const spans = claimSpans(drafted.text);
  const candidates: (readonly RetrievedSlide[])[] = [];
  for (const span of spans) candidates.push(await searchSentence(span.text));
  const attributed = attributeSentences(drafted.text, spans, candidates, drafted.quotes, retrieved);
  const marked = await markContradictions(
    attributed,
    (request) => deps.gateway.verifier.entail(request),
    deps.thresholds,
  );
  const slides = uniqueSlides([...retrieved, ...attributed.flatMap(({ slides: named }) => named)]);
  return shown(drafted, marked, spans, slides, retrieved);
};

const deep = async (
  drafted: Drafted,
  retrieved: Retrieved,
  secondOpinion: boolean,
  deps: ExplainDeps,
): Promise<ExplainResult> => {
  const sentences = claimSpans(drafted.text).map(({ text }) => text);
  const verified = await verifyExplanation(sentences, retrieved, { ...deps, secondOpinion });
  if (verified.status === 'model-failed') return { ...verified, stage: 'verify' };
  const withheld = [...drafted.withheld, ...verified.withheld];
  if (verified.kept.length === 0) return { status: 'not-covered', withheld };
  const kept = verified.kept.map((sentence) => sentence.text);
  const text = kept.join(' ');
  const spans = spansOf(text, kept);
  const quotes = drafted.quotes.filter(({ quote }) => quoteSpan(text, quote) !== undefined);
  return shown({ text, quotes, withheld }, verified.kept, spans, retrieved, retrieved);
};

/** `docs/standards/grounding.md` rule 2's order, the verify stage by depth (`docs/adr/0009-explanation-answers.md` § Decision (b)–(g)). */
export const explain = async (
  question: string,
  retrieved: readonly RetrievedSlide[],
  depth: ExplainDepth,
  deps: ExplainDeps,
): Promise<ExplainResult> => {
  const [head, ...tail] = retrieved;
  if (head === undefined) return { status: 'not-covered', withheld: [] };
  const reply = await deps.gateway.generator.chat(explanationRequest(question, retrieved));
  if (reply.status !== 'completed')
    return { status: 'model-failed', stage: 'generate', failure: reply };
  const { answer } = reply.value;
  if (answer === null) return { status: 'not-covered', withheld: [] };
  const drafted = { text: answer.text, ...resolveQuotes(answer.text, answer.quotes, retrieved) };
  const nonEmpty: Retrieved = [head, ...tail];
  return depth.depth === 'light'
    ? light(drafted, nonEmpty, depth.searchSentence, deps)
    : deep(drafted, nonEmpty, depth.secondOpinion, deps);
};
