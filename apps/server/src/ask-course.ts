import type { ModelGateway } from '@cram/gateway';
import { ask, PROVISIONAL_NLI_THRESHOLDS, PROVISIONAL_VERIFIER_STRATEGY } from '@cram/grounding';
import type { CourseIndex, SearchHit, SearchQuery } from '@cram/index';
import type { AskReply, CourseId } from '@cram/shared';
import { type CourseFiles, courseExists, openForRead } from './course-file';
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
  | { readonly status: 'course-unavailable'; readonly problem: string };

const retrieve = (course: CourseIndex, query: SearchQuery): readonly SearchHit[] => {
  try {
    return course.search(query);
  } finally {
    course.close();
  }
};

/** Retrieve, then `@cram/grounding`'s `ask` (`docs/standards/grounding.md` rule 2). */
export const askCourse = async (
  courseId: CourseId,
  question: string,
  deps: AskDeps,
): Promise<AskOutcome> => {
  if (!courseExists(deps.files, courseId)) return { status: 'no-such-course' };
  const embedding = await embedQuestion(deps.gateway.embedder, question);
  const opened = openForRead(deps.files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const slides = retrieve(opened.course, { text: question, embedding });
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
        },
      };
    case 'not-covered':
      return {
        status: 'replied',
        reply: { ...result, withheld: [...result.withheld], slides: [...slides] },
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
