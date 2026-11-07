import type { ModelGateway } from '@cram/gateway';
import {
  type AskRequest,
  type AttributedSentence,
  type Citation,
  type Explanation,
  type LoadedSummary,
  quoteSpan,
  type RetrievedSlide,
  type WithheldSentence,
} from '@cram/shared';
import { type AssembledContext, assembleContext, EMPTY_CONTEXT } from './assemble-context';
import { attributeSentences, quotesIn, sourcesOf, uniqueSlides } from './attribute-sentences';
import { type ClaimSpan, claimSpans, spansOf } from './claims';
import { markContradictions } from './mark-contradictions';
import type { ModelFailure } from './model-failure';
import type { NliThresholds } from './nli-verdict';
import { contextPremises } from './premise';
import { PROMPT_TOKEN_BUDGET, requestTokens } from './prompt-budget';
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

export interface ExplainSources {
  readonly retrieved: readonly RetrievedSlide[];
  readonly summaries: readonly LoadedSummary[];
}

export interface BudgetedDeps extends ExplainDeps {
  readonly budget?: number;
}

export type ExplainStage = 'generate' | 'verify';

/** `slides` is the retrieved set, then each slide a sentence names beyond it; `context` is what the prompt held. */
export type ExplainResult =
  | {
      readonly status: 'grounded';
      readonly explanation: Explanation;
      readonly withheld: readonly WithheldSentence[];
      readonly slides: readonly RetrievedSlide[];
      readonly context: AssembledContext;
    }
  | {
      readonly status: 'not-covered';
      readonly withheld: readonly WithheldSentence[];
      readonly context: AssembledContext;
    }
  | {
      readonly status: 'model-failed';
      readonly stage: ExplainStage;
      readonly failure: ModelFailure;
      readonly context: AssembledContext;
    };

interface Drafted {
  readonly text: string;
  readonly quotes: readonly Citation[];
  readonly withheld: readonly WithheldSentence[];
}

type Raw = readonly [RetrievedSlide, ...RetrievedSlide[]];

interface Assembled {
  readonly raw: Raw;
  readonly retrieved: readonly RetrievedSlide[];
  readonly context: AssembledContext;
}

const shown = (
  { text, quotes, withheld }: Drafted,
  sentences: readonly AttributedSentence[],
  spans: readonly ClaimSpan[],
  slides: readonly RetrievedSlide[],
  { raw: [head, ...tail], context }: Assembled,
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
    context,
  };
};

const light = async (
  drafted: Drafted,
  assembled: Assembled,
  searchSentence: SearchSentence,
  deps: ExplainDeps,
): Promise<ExplainResult> => {
  const spans = claimSpans(drafted.text);
  const candidates: (readonly RetrievedSlide[])[] = [];
  for (const span of spans) candidates.push(await searchSentence(span.text));
  const attributed = attributeSentences(
    drafted.text,
    spans,
    candidates,
    drafted.quotes,
    assembled.raw,
  );
  const marked = await markContradictions(
    attributed,
    (request) => deps.gateway.verifier.entail(request),
    deps.thresholds,
  );
  const slides = uniqueSlides([
    ...assembled.retrieved,
    ...attributed.flatMap(({ slides: named }) => named),
  ]);
  return shown(drafted, marked, spans, slides, assembled);
};

const deepSlides = (
  { retrieved, context }: Assembled,
  kept: readonly AttributedSentence[],
  withheld: readonly WithheldSentence[],
): readonly RetrievedSlide[] => {
  const named = new Set([
    ...kept.flatMap(({ slides }) => slides),
    ...withheld.flatMap((entry) => ('sourceId' in entry ? [entry.sourceId] : [])),
  ]);
  const summarised = context.summaries.flatMap(({ slides }) => slides);
  return uniqueSlides([...retrieved, ...summarised.filter(({ sourceId }) => named.has(sourceId))]);
};

const deep = async (
  drafted: Drafted,
  assembled: Assembled,
  secondOpinion: boolean,
  deps: ExplainDeps,
): Promise<ExplainResult> => {
  const sentences = claimSpans(drafted.text).map(({ text }) => text);
  const verified = await verifyExplanation(sentences, contextPremises(assembled.context), {
    ...deps,
    secondOpinion,
  });
  const { context } = assembled;
  if (verified.status === 'model-failed') return { ...verified, stage: 'verify', context };
  const withheld = [...drafted.withheld, ...verified.withheld];
  if (verified.kept.length === 0) return { status: 'not-covered', withheld, context };
  const kept = verified.kept.map((sentence) => sentence.text);
  const text = kept.join(' ');
  const spans = spansOf(text, kept);
  const quotes = drafted.quotes.filter(({ quote }) => quoteSpan(text, quote) !== undefined);
  const slides = deepSlides(assembled, verified.kept, withheld);
  return shown({ text, quotes, withheld }, verified.kept, spans, slides, assembled);
};

/** `docs/standards/grounding.md` rule 2's order, the verify stage by depth (`docs/adr/0009-explanation-answers.md` § Decision (b)–(g), (k)); `turns` as `carriedTurns` returns them. */
export const explain = async (
  { question, turns }: AskRequest,
  { retrieved, summaries }: ExplainSources,
  depth: ExplainDepth,
  { budget = PROMPT_TOKEN_BUDGET, ...deps }: BudgetedDeps,
): Promise<ExplainResult> => {
  const fixed = requestTokens(explanationRequest(question, EMPTY_CONTEXT, turns));
  const context = assembleContext(retrieved, summaries, budget - fixed);
  const [head, ...tail] = context.raw;
  if (head === undefined) return { status: 'not-covered', withheld: [], context };
  const reply = await deps.gateway.generator.chat(explanationRequest(question, context, turns));
  if (reply.status !== 'completed')
    return { status: 'model-failed', stage: 'generate', failure: reply, context };
  const { answer } = reply.value;
  if (answer === null) return { status: 'not-covered', withheld: [], context };
  const raw: Raw = [head, ...tail];
  const drafted = { text: answer.text, ...resolveQuotes(answer.text, answer.quotes, raw) };
  const assembled = { raw, retrieved, context };
  return depth.depth === 'light'
    ? light(drafted, assembled, depth.searchSentence, deps)
    : deep(drafted, assembled, depth.secondOpinion, deps);
};
