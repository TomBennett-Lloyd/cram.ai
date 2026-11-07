import type { Embedder, ModelGateway } from '@cram/gateway';
import {
  ask,
  carriedTurns,
  explanationRequest,
  PROVISIONAL_NLI_THRESHOLDS,
  requestTokens,
  type SearchSentence,
  standaloneQuestion,
} from '@cram/grounding';
import { ATTRIBUTION_K, type CourseReader, loadSummaries } from '@cram/index';
import type {
  AskReply,
  AskRequest,
  CourseId,
  CourseUnavailableProblem,
  LoadedSummary,
  RetrievedSlide,
} from '@cram/shared';
import { type CourseFiles, courseExists, openToRead } from './course-file';
import { modelFailureOutcome, type ServerLog } from './server-log';
import { embedQuestion } from './slide-embedding';

export interface AskDeps {
  readonly files: CourseFiles;
  readonly gateway: ModelGateway;
  readonly log: ServerLog;
}

export type AskOutcome =
  | { readonly status: 'replied'; readonly reply: AskReply }
  | { readonly status: 'no-such-course' }
  | { readonly status: 'question-over-length'; readonly maxInputTokens: number }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

type Retrieval =
  | { readonly status: 'over-length'; readonly maxInputTokens: number }
  | {
      readonly status: 'retrieved';
      readonly slides: readonly RetrievedSlide[];
      readonly summaries: readonly LoadedSummary[];
      readonly searched: string | undefined;
    };

const retrieve = async (
  course: CourseReader | undefined,
  { search, typed }: { readonly search: string; readonly typed: string },
  embedder: Embedder,
): Promise<Retrieval> => {
  const correction = course?.correctSpelling(search);
  const text = correction?.status === 'corrected' ? correction.searched : search;
  const embedded = await embedQuestion(embedder, text);
  if (embedded.status === 'over-length')
    return { status: 'over-length', maxInputTokens: embedded.maxInputTokens };
  const slides = course?.search({ text, embedding: embedded.vector }) ?? [];
  return {
    status: 'retrieved',
    slides,
    summaries: course === undefined ? [] : loadSummaries(course, slides),
    searched: text === typed ? undefined : text,
  };
};

const retrieveFollowUp = async (
  course: CourseReader | undefined,
  search: string,
  typed: string,
  embedder: Embedder,
): Promise<Retrieval & { readonly rewriteOverLength: boolean }> => {
  const retrieval = await retrieve(course, { search, typed }, embedder);
  if (retrieval.status === 'retrieved' || search === typed)
    return { ...retrieval, rewriteOverLength: false };
  return {
    ...(await retrieve(course, { search: typed, typed }, embedder)),
    rewriteOverLength: true,
  };
};

const sentenceSearch =
  (course: CourseReader | undefined, embedder: Embedder): SearchSentence =>
  async (sentence) => {
    const embedded = await embedQuestion(embedder, sentence);
    if (embedded.status === 'over-length' || course === undefined) return [];
    return course.search({ text: sentence, embedding: embedded.vector }, ATTRIBUTION_K);
  };

type Asked =
  | {
      readonly status: 'over-length';
      readonly maxInputTokens: number;
      readonly rewriteOverLength: boolean;
    }
  | {
      readonly status: 'asked';
      readonly result: Awaited<ReturnType<typeof ask>>;
      readonly retrieved: readonly RetrievedSlide[];
      readonly searched: string | undefined;
      readonly rewriteOverLength: boolean;
    };

const askOpen = async (
  course: CourseReader | undefined,
  asked: AskRequest,
  search: string,
  gateway: ModelGateway,
): Promise<Asked> => {
  try {
    const retrieval = await retrieveFollowUp(course, search, asked.question, gateway.embedder);
    if (retrieval.status === 'over-length') return retrieval;
    const { slides: retrieved, summaries, searched, rewriteOverLength } = retrieval;
    const result = await ask(
      asked,
      { retrieved, summaries },
      {
        gateway,
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        searchSentence: sentenceSearch(course, gateway.embedder),
      },
    );
    return { status: 'asked', result, retrieved, searched, rewriteOverLength };
  } finally {
    course?.close();
  }
};

const contextOutcome = (
  { question, turns }: AskRequest,
  dropped: number,
  { context }: Awaited<ReturnType<typeof ask>>,
): string =>
  `${String(requestTokens(explanationRequest(question, context, turns)))} prompt tokens, ${String(context.leftOut.length)} left out, ${String(turns.length)} turns carried, ${String(dropped)} turns dropped`;

const rewriteOutcome = (asked: Asked, kept: boolean): string => {
  if (asked.rewriteOverLength) return 'over-length';
  return kept ? 'kept' : 'rewritten';
};

const sameWords = (left: string, right: string): boolean =>
  left.replace(/\s+/g, ' ').trim() === right.replace(/\s+/g, ' ').trim();

/** Retrieve on a follow-up's standalone rewrite, else the corrected question (#393), then `@cram/grounding`'s `ask` on the typed one with the carried turns (`docs/adr/0011-ask-conversation.md` § Decision (b)–(d); `docs/standards/grounding.md` rule 2). */
export const askCourse = async (
  courseId: CourseId,
  request: AskRequest,
  deps: AskDeps,
): Promise<AskOutcome> => {
  if (!courseExists(deps.files, courseId)) return { status: 'no-such-course' };
  const { carried, dropped } = carriedTurns(request.turns);
  if (carried.length > 0) {
    const typed = await embedQuestion(deps.gateway.embedder, request.question);
    if (typed.status === 'over-length')
      return { status: 'question-over-length', maxInputTokens: typed.maxInputTokens };
  }
  const rewrite =
    carried.length === 0
      ? undefined
      : await standaloneQuestion(request.question, carried, deps.gateway.generator);
  if (rewrite?.status === 'model-failed') {
    deps.log({ operation: 'ask rewrite', courseId, outcome: modelFailureOutcome(rewrite.failure) });
    return { status: 'replied', reply: { status: 'model-failed' } };
  }
  const opened = openToRead(deps.files, courseId);
  if (opened.status !== 'open' && opened.status !== 'blank')
    return { status: 'course-unavailable', problem: opened.status };
  const kept = rewrite === undefined || sameWords(rewrite.question, request.question);
  const thread = { question: request.question, turns: [...carried] };
  const asked = await askOpen(
    opened.status === 'open' ? opened.course : undefined,
    thread,
    kept ? request.question : rewrite.question,
    deps.gateway,
  );
  if (rewrite !== undefined)
    deps.log({ operation: 'ask rewrite', courseId, outcome: rewriteOutcome(asked, kept) });
  if (asked.status === 'over-length')
    return { status: 'question-over-length', maxInputTokens: asked.maxInputTokens };
  const { result, retrieved, searched } = asked;
  const named = searched === undefined ? {} : { searched };
  const { leftOut } = result.context;
  if (result.context.raw.length > 0)
    deps.log({
      operation: 'ask context',
      courseId,
      outcome: contextOutcome(thread, dropped, result),
    });
  switch (result.status) {
    case 'grounded':
      return {
        status: 'replied',
        reply: {
          status: 'grounded',
          explanation: result.explanation,
          withheld: [...result.withheld],
          slides: [...result.slides],
          leftOut: [...leftOut],
          ...named,
        },
      };
    case 'not-covered':
      return {
        status: 'replied',
        reply: {
          status: 'not-covered',
          withheld: [...result.withheld],
          slides: [...retrieved],
          leftOut: [...leftOut],
          ...named,
        },
      };
    case 'model-failed':
      deps.log({
        operation: `ask ${result.stage}`,
        courseId,
        outcome: modelFailureOutcome(result.failure),
      });
      return { status: 'replied', reply: { status: 'model-failed' } };
  }
};
