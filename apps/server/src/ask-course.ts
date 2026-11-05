import type { Embedder, ModelGateway } from '@cram/gateway';
import {
  ask,
  explanationRequest,
  PROVISIONAL_NLI_THRESHOLDS,
  requestTokens,
  type SearchSentence,
} from '@cram/grounding';
import { ATTRIBUTION_K, type CourseReader, loadSummaries } from '@cram/index';
import type {
  AskReply,
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
  question: string,
  embedder: Embedder,
): Promise<Retrieval> => {
  const correction = course?.correctSpelling(question);
  const text = correction?.status === 'corrected' ? correction.searched : question;
  const embedded = await embedQuestion(embedder, text);
  if (embedded.status === 'over-length')
    return { status: 'over-length', maxInputTokens: embedded.maxInputTokens };
  const slides = course?.search({ text, embedding: embedded.vector }) ?? [];
  return {
    status: 'retrieved',
    slides,
    summaries: course === undefined ? [] : loadSummaries(course, slides),
    searched: correction?.status === 'corrected' ? text : undefined,
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
  | { readonly status: 'over-length'; readonly maxInputTokens: number }
  | {
      readonly status: 'asked';
      readonly result: Awaited<ReturnType<typeof ask>>;
      readonly retrieved: readonly RetrievedSlide[];
      readonly searched: string | undefined;
    };

const askOpen = async (
  course: CourseReader | undefined,
  question: string,
  gateway: ModelGateway,
): Promise<Asked> => {
  try {
    const retrieval = await retrieve(course, question, gateway.embedder);
    if (retrieval.status === 'over-length') return retrieval;
    const { slides: retrieved, summaries } = retrieval;
    const result = await ask(
      question,
      { retrieved, summaries },
      {
        gateway,
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
        searchSentence: sentenceSearch(course, gateway.embedder),
      },
    );
    return { status: 'asked', result, retrieved, searched: retrieval.searched };
  } finally {
    course?.close();
  }
};

const contextOutcome = (question: string, { context }: Awaited<ReturnType<typeof ask>>): string =>
  `${String(requestTokens(explanationRequest(question, context)))} prompt tokens, ${String(context.leftOut.length)} left out`;

/** Retrieve on the corrected question (#393), then `@cram/grounding`'s `ask` on the typed one (`docs/standards/grounding.md` rule 2). */
export const askCourse = async (
  courseId: CourseId,
  question: string,
  deps: AskDeps,
): Promise<AskOutcome> => {
  if (!courseExists(deps.files, courseId)) return { status: 'no-such-course' };
  const opened = openToRead(deps.files, courseId);
  if (opened.status !== 'open' && opened.status !== 'blank')
    return { status: 'course-unavailable', problem: opened.status };
  const asked = await askOpen(
    opened.status === 'open' ? opened.course : undefined,
    question,
    deps.gateway,
  );
  if (asked.status === 'over-length')
    return { status: 'question-over-length', maxInputTokens: asked.maxInputTokens };
  const { result, retrieved, searched } = asked;
  const named = searched === undefined ? {} : { searched };
  const { leftOut } = result.context;
  if (result.context.raw.length > 0)
    deps.log({ operation: 'ask context', courseId, outcome: contextOutcome(question, result) });
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
