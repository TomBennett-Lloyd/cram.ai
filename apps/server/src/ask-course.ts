import type { Embedder, ModelGateway } from '@cram/gateway';
import { ask, PROVISIONAL_NLI_THRESHOLDS, PROVISIONAL_VERIFIER_STRATEGY } from '@cram/grounding';
import type { CourseReader } from '@cram/index';
import type { AskReply, CourseId, CourseUnavailableProblem, RetrievedSlide } from '@cram/shared';
import { type CourseFiles, courseExists, openToRead } from './course-file';
import type { ServerLog } from './server-log';
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
      readonly searched: string | undefined;
    };

const retrieve = async (
  course: CourseReader | undefined,
  question: string,
  embedder: Embedder,
): Promise<Retrieval> => {
  try {
    const correction = course?.correctSpelling(question);
    const text = correction?.status === 'corrected' ? correction.searched : question;
    const embedded = await embedQuestion(embedder, text);
    if (embedded.status === 'over-length')
      return { status: 'over-length', maxInputTokens: embedded.maxInputTokens };
    return {
      status: 'retrieved',
      slides: course?.search({ text, embedding: embedded.vector }) ?? [],
      searched: correction?.status === 'corrected' ? text : undefined,
    };
  } finally {
    course?.close();
  }
};

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
  const retrieval = await retrieve(
    opened.status === 'open' ? opened.course : undefined,
    question,
    deps.gateway.embedder,
  );
  if (retrieval.status === 'over-length')
    return { status: 'question-over-length', maxInputTokens: retrieval.maxInputTokens };
  const { slides, searched } = retrieval;
  const result = await ask(question, slides, {
    gateway: deps.gateway,
    strategy: PROVISIONAL_VERIFIER_STRATEGY,
    thresholds: PROVISIONAL_NLI_THRESHOLDS,
  });
  switch (result.status) {
    case 'grounded':
      return {
        status: 'replied',
        reply: {
          ...result,
          shown: [...result.shown],
          withheld: [...result.withheld],
          slides: [...slides],
          ...(searched === undefined ? {} : { searched }),
        },
      };
    case 'not-covered':
      return {
        status: 'replied',
        reply: {
          ...result,
          withheld: [...result.withheld],
          slides: [...slides],
          ...(searched === undefined ? {} : { searched }),
        },
      };
    case 'model-failed':
      deps.log({
        operation: `ask ${result.stage}`,
        courseId,
        outcome: result.failure.status,
      });
      return { status: 'replied', reply: { status: 'model-failed' } };
  }
};
