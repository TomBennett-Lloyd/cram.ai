import { FakeGateway } from '@cram/gateway';
import type { CourseId } from '@cram/shared';
import type { EvalCourse } from './audit';
import type { IndexedLecture } from './index-retriever';
import type { LatencySummary } from './latency';
import { LIVE_PINS, LIVE_SAMPLING } from './live-config';
import type { EvalReport } from './report';
import type { EvalRun } from './run-files';
import { runEval } from './run-eval';

export interface ReplaySpec {
  readonly run: EvalRun;
  readonly courseId: CourseId;
  readonly course: EvalCourse;
  readonly lectures: readonly IndexedLecture[];
}

/**
 * Tier 1 (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)), keyed by the live pins and sampling
 * so a re-pin or a prompt change misses; the run's own facts, `servedGenerator` among them, carry over.
 */
export const replayRun = (spec: ReplaySpec): Promise<EvalReport> =>
  runEval({
    facts: {
      measuredCommit: spec.run.report.measuredCommit,
      pullRequest: spec.run.report.pullRequest,
      machineClass: spec.run.report.machineClass,
    },
    courseId: spec.courseId,
    lectures: spec.lectures,
    questions: spec.course.questions,
    labels: spec.course.labels,
    gateway: new FakeGateway({
      pins: LIVE_PINS,
      sampling: LIVE_SAMPLING,
      recordings: spec.run.recordings,
      served: spec.run.report.servedGenerator,
    }),
    clock: () => 0,
  });

const samplesOnly = (summary: LatencySummary) =>
  summary.status === 'measured' ? { status: summary.status, samples: summary.samples } : summary;

/** `report` less its wall-clock durations, which no replay reproduces; the sample counts stay. */
export const untimed = (report: EvalReport) => {
  const { verifierArms: arms, latency } = report;
  return {
    ...report,
    verifierArms: {
      ...arms,
      nli: { ...arms.nli, perUnitLatency: samplesOnly(arms.nli.perUnitLatency) },
      llm: { ...arms.llm, perUnitLatency: samplesOnly(arms.llm.perUnitLatency) },
      nliThenLlm: {
        ...arms.nliThenLlm,
        perUnitLatency: samplesOnly(arms.nliThenLlm.perUnitLatency),
      },
    },
    latency: {
      ...latency,
      ask: samplesOnly(latency.ask),
      perCall: {
        generator: samplesOnly(latency.perCall.generator),
        verifier: samplesOnly(latency.perCall.verifier),
        embedder: samplesOnly(latency.perCall.embedder),
        reranker: samplesOnly(latency.perCall.reranker),
      },
    },
  };
};
