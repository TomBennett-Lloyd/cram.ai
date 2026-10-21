import type { ModelGateway } from '@cram/gateway';
import {
  ask,
  PROVISIONAL_NLI_THRESHOLDS,
  PROVISIONAL_VERIFIER_STRATEGY,
  type VerifierStrategy,
  verifyStatement,
} from '@cram/grounding';
import { RETRIEVAL_K } from '@cram/index';
import type { CourseId, RetrievedSlide } from '@cram/shared';
import type { AskedQuestion } from './asked-question';
import { citationValidity } from './citation-validity';
import { contradictionSet } from './contradiction-set';
import type { GoldenQuestion } from './golden-question';
import type { HandLabel } from './hand-label';
import { IndexRetriever, type IndexedLecture } from './index-retriever';
import { type Clock, latencySummary, timed } from './latency';
import { notMeasurable } from './metric-row';
import { EvalReport, type MachineClass } from './report';
import { retrievalRecall } from './retrieval-recall';
import { TimedGateway } from './timed-gateway';
import { type JudgedLabel, verifierAccuracy } from './verifier-accuracy';
import { verifierArmDecisions } from './verifier-arms';

/** What the report records about the run itself (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)). */
export interface EvalRunFacts {
  readonly measuredCommit: string;
  readonly pullRequest: number;
  readonly machineClass: MachineClass;
}

export interface EvalRunSpec {
  readonly facts: EvalRunFacts;
  readonly courseId: CourseId;
  readonly lectures: readonly IndexedLecture[];
  readonly questions: readonly GoldenQuestion[];
  readonly labels: readonly HandLabel[];
  readonly gateway: ModelGateway;
  readonly clock: Clock;
}

/** Ask runs under the strategy that ships and under each arm whose `ArmsEvidence` entry holds a `contradictionSet`. */
const ASK_STRATEGIES: readonly VerifierStrategy[] = [
  ...new Set<VerifierStrategy>([PROVISIONAL_VERIFIER_STRATEGY, 'nli', 'nli-then-llm']),
];
const LABEL_STRATEGIES: readonly VerifierStrategy[] = ['nli', 'llm', 'nli-then-llm'];

interface Retrieved {
  readonly question: GoldenQuestion;
  readonly retrieved: readonly RetrievedSlide[];
}

interface AskTiming {
  readonly clock: Clock;
  readonly durationsMs: number[];
}

interface Judged {
  readonly judged: readonly JudgedLabel[];
  readonly durationsMs: readonly number[];
}

const askAll = async (
  retrievals: readonly Retrieved[],
  gateway: ModelGateway,
  strategy: VerifierStrategy,
  timing: AskTiming,
): Promise<readonly AskedQuestion[]> => {
  const deps = { gateway, strategy, thresholds: PROVISIONAL_NLI_THRESHOLDS };
  const asked: AskedQuestion[] = [];
  for (const { question, retrieved } of retrievals) {
    const result = await timed(
      timing.clock,
      (ms) => timing.durationsMs.push(ms),
      () => ask(question.question, retrieved, deps),
    );
    asked.push({ question, retrieved, result });
  }
  return asked;
};

const judgeAll = async (
  labels: readonly HandLabel[],
  gateway: ModelGateway,
  strategy: VerifierStrategy,
  clock: Clock,
): Promise<Judged> => {
  const deps = { gateway, strategy, thresholds: PROVISIONAL_NLI_THRESHOLDS };
  const judged: JudgedLabel[] = [];
  const durationsMs: number[] = [];
  for (const label of labels) {
    const [first, ...rest] = label.quotes;
    if (first === undefined) throw new Error('runEval: a hand label has no quote');
    const outcome = await timed(
      clock,
      (ms) => durationsMs.push(ms),
      () => verifyStatement({ text: label.text, quotes: [first, ...rest] }, deps),
    );
    judged.push({ handVerdict: label.verdict, outcome });
  }
  return { judged, durationsMs };
};

const retrieveAll = async (
  spec: EvalRunSpec,
  gateway: ModelGateway,
): Promise<readonly Retrieved[]> => {
  const retriever = await IndexRetriever.open({
    courseId: spec.courseId,
    lectures: spec.lectures,
    embedder: gateway.embedder,
    k: RETRIEVAL_K,
  });
  try {
    const retrievals: Retrieved[] = [];
    for (const question of spec.questions)
      retrievals.push({ question, retrieved: await retriever.retrieve(question.question) });
    return retrievals;
  } finally {
    retriever.close();
  }
};

const byStrategy = async <T>(
  strategies: readonly VerifierStrategy[],
  run: (strategy: VerifierStrategy) => Promise<T>,
): Promise<ReadonlyMap<VerifierStrategy, T>> => {
  const results = new Map<VerifierStrategy, T>();
  for (const strategy of strategies) results.set(strategy, await run(strategy));
  return results;
};

const pick = <T>(map: ReadonlyMap<VerifierStrategy, T>, strategy: VerifierStrategy): T => {
  const value = map.get(strategy);
  if (value === undefined) throw new Error(`runEval: no run under ${strategy}`);
  return value;
};

const NOT_YET = {
  exams: 'no exam generator exists until M4 (docs/plan.md §8), so no generated question',
  marks: 'no synthetic student answer carries hand marks, and no ticket delivers them yet (#181)',
  derived: 'no OCR adapter derives text from imageOnly slides until #108',
  generatorTiming: 'Generator.chat reports neither first-token time nor token counts (#138)',
};

/**
 * One whole run (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)): retrieve and Ask every
 * golden question, verify every hand label under each arm, then report. A recording miss rejects
 * the run; it never yields a report.
 */
export const runEval = async (spec: EvalRunSpec): Promise<EvalReport> => {
  const gateway = new TimedGateway(spec.gateway, spec.clock);
  const retrievals = await retrieveAll(spec, gateway);
  const askMs: number[] = [];
  const asks = await byStrategy(ASK_STRATEGIES, (strategy) =>
    askAll(retrievals, gateway, strategy, {
      clock: spec.clock,
      durationsMs: strategy === PROVISIONAL_VERIFIER_STRATEGY ? askMs : [],
    }),
  );
  const labels = await byStrategy(LABEL_STRATEGIES, (strategy) =>
    judgeAll(spec.labels, gateway, strategy, spec.clock),
  );
  const arm = (strategy: VerifierStrategy) => {
    const { judged, durationsMs } = pick(labels, strategy);
    return {
      accuracy: verifierAccuracy(judged),
      perUnitLatency: latencySummary(durationsMs, 'no hand label was verified'),
    };
  };
  const withSet = (strategy: VerifierStrategy) => ({
    ...arm(strategy),
    contradictionSet: contradictionSet(pick(asks, strategy)),
  });
  const nli = withSet('nli');
  const llm = arm('llm');
  const nliThenLlm = withSet('nli-then-llm');
  const headline = pick(asks, PROVISIONAL_VERIFIER_STRATEGY);
  const headlineAccuracy = arm(PROVISIONAL_VERIFIER_STRATEGY).accuracy;
  const perCall = (role: 'generator' | 'verifier' | 'embedder' | 'reranker') =>
    latencySummary(gateway.durations(role), `no ${role} call was made`);
  const inner = spec.gateway;
  return EvalReport.parse({
    measuredCommit: spec.facts.measuredCommit,
    pullRequest: spec.facts.pullRequest,
    machineClass: spec.facts.machineClass,
    pins: {
      generator: inner.generator.pin,
      verifier: inner.verifier.pin,
      embedder: inner.embedder.pin,
      reranker: inner.reranker?.pin ?? null,
    },
    servedGenerator: inner.generator.served,
    determinism: { generator: inner.generator.sampling },
    nliThresholds: PROVISIONAL_NLI_THRESHOLDS,
    retrievalK: RETRIEVAL_K,
    verifierStrategy: PROVISIONAL_VERIFIER_STRATEGY,
    metrics: {
      citationValidity: citationValidity(headline),
      contradictionSet: contradictionSet(headline),
      retrievalRecall: retrievalRecall(retrievals, RETRIEVAL_K),
      verifierPrecision: headlineAccuracy.precision,
      verifierRecall: headlineAccuracy.recall,
      examAnswerability: notMeasurable(NOT_YET.exams),
      gradingAgreement: notMeasurable(NOT_YET.marks),
      derivedTextCoverage: notMeasurable(NOT_YET.derived),
      derivedTextRecall: notMeasurable(NOT_YET.derived),
      derivedTextPrecision: notMeasurable(NOT_YET.derived),
    },
    verifierArms: { nli, llm, nliThenLlm, ...verifierArmDecisions({ nli, llm, nliThenLlm }) },
    latency: {
      ask: latencySummary(askMs, 'no golden question was asked'),
      perCall: {
        generator: perCall('generator'),
        verifier: perCall('verifier'),
        embedder: perCall('embedder'),
        reranker: perCall('reranker'),
      },
      generatorTimeToFirstToken: notMeasurable(NOT_YET.generatorTiming),
      generatorTokensPerSecond: notMeasurable(NOT_YET.generatorTiming),
    },
  });
};
