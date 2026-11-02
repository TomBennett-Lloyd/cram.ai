import type { ModelGateway } from '@cram/gateway';
import {
  classifySentenceKinds,
  PROVISIONAL_NLI_THRESHOLDS,
  PROVISIONAL_VERIFIER_STRATEGY,
  type VerifierStrategy,
  slideText,
  verifyStatement,
} from '@cram/grounding';
import { ATTRIBUTION_K, RETRIEVAL_K } from '@cram/index';
import type { CourseId } from '@cram/shared';
import { askDeep, askLight, type Retrieved, widened } from './ask-depths';
import { citationValidity } from './citation-validity';
import { contradictionSet } from './contradiction-set';
import {
  attributionCounts,
  explanationEntailed,
  explanationWithheld,
  quotedShare,
} from './depth-rows';
import type { GoldenQuestion } from './golden-question';
import type { HandLabel } from './hand-label';
import { IndexRetriever, type IndexedLecture } from './index-retriever';
import { type Clock, latencySummary, timed } from './latency';
import { attributionRecall, contradictionSetLight, lightFlagRate } from './light-rows';
import { notMeasurable } from './metric-row';
import { EvalReport, type MachineClass } from './report';
import { misspeltRetrievalRecall, retrievalRecall } from './retrieval-recall';
import { summaryRows } from './summary-rows';
import { type JudgedKind, sentenceKindAccuracy } from './sentence-kind-accuracy';
import type { SentenceKindLabel } from './sentence-kind-label';
import { tagRecall } from './tag-recall';
import type { TopicLabel } from './topic-label';
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
  readonly sentenceKinds: readonly SentenceKindLabel[];
  readonly topicLabels: readonly TopicLabel[];
  readonly gateway: ModelGateway;
  readonly clock: Clock;
}

/** The deep run is the gate under the strategy that ships, and runs under each arm whose `ArmsEvidence` entry holds a `contradictionSet`. */
const DEEP_STRATEGIES: readonly VerifierStrategy[] = [
  ...new Set<VerifierStrategy>([PROVISIONAL_VERIFIER_STRATEGY, 'nli', 'nli-then-llm']),
];
const LABEL_STRATEGIES: readonly VerifierStrategy[] = ['nli', 'llm', 'nli-then-llm'];

interface Judged {
  readonly judged: readonly JudgedLabel[];
  readonly durationsMs: readonly number[];
}

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

const judgeKinds = async (
  labels: readonly SentenceKindLabel[],
  lectures: readonly IndexedLecture[],
  gateway: ModelGateway,
): Promise<readonly JudgedKind[]> => {
  const records = lectures.flatMap(({ slides }) => slides);
  const judged: JudgedKind[] = [];
  for (const { sentence, premises, kind } of labels) {
    const texts = premises.map(({ lectureId, slideNo }) => {
      const record = records.find((r) => r.lectureId === lectureId && r.slideNo === slideNo);
      if (record === undefined)
        throw new Error(
          `runEval: no slide ${lectureId}#${String(slideNo)} for a sentence-kind label`,
        );
      return slideText(record);
    });
    const [returned] = await classifySentenceKinds([sentence], texts, gateway.generator);
    if (returned === undefined) throw new Error('runEval: the judge returned no kind');
    judged.push({ labelled: kind, returned });
  }
  return judged;
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

/** One whole run (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)), both depths over one retrieved set, misspelt variants retrieved only; a recording miss rejects it. */
export const runEval = async (spec: EvalRunSpec): Promise<EvalReport> => {
  const gateway = new TimedGateway(spec.gateway, spec.clock);
  const retriever = await IndexRetriever.open({
    courseId: spec.courseId,
    lectures: spec.lectures,
    embedder: gateway.embedder,
    k: RETRIEVAL_K,
  });
  const ran = await (async () => {
    try {
      const tagged = await retriever.tag({ generator: gateway.generator });
      const summaries = await retriever.summarise({
        gateway,
        strategy: PROVISIONAL_VERIFIER_STRATEGY,
        thresholds: PROVISIONAL_NLI_THRESHOLDS,
      });
      const retrievals: Retrieved[] = [];
      const misspelt: Retrieved[] = [];
      for (const question of spec.questions) {
        retrievals.push({ question, retrieved: await retriever.retrieve(question.question) });
        for (const variant of question.misspelt)
          misspelt.push({ question, retrieved: await retriever.retrieve(variant) });
      }
      const light = await askLight(retrievals, retriever, gateway, spec.clock);
      const deep = await byStrategy(DEEP_STRATEGIES, (strategy) =>
        askDeep(retrievals, gateway, strategy),
      );
      return {
        tagged,
        summaries,
        retrievals,
        misspelt,
        light,
        deep,
        wide: await widened(light.asked, gateway),
      };
    } finally {
      retriever.close();
    }
  })();
  const { tagged, summaries, retrievals, misspelt, light, deep, wide } = ran;
  const labels = await byStrategy(LABEL_STRATEGIES, (strategy) =>
    judgeAll(spec.labels, gateway, strategy, spec.clock),
  );
  const kinds = sentenceKindAccuracy(await judgeKinds(spec.sentenceKinds, spec.lectures, gateway));
  const arm = (strategy: VerifierStrategy) => {
    const { judged, durationsMs } = pick(labels, strategy);
    return {
      accuracy: verifierAccuracy(judged),
      perUnitLatency: latencySummary(durationsMs, 'no hand label was verified'),
    };
  };
  const withSet = (strategy: VerifierStrategy) => ({
    ...arm(strategy),
    contradictionSet: contradictionSet(pick(deep, strategy)),
  });
  const nli = withSet('nli');
  const llm = arm('llm');
  const nliThenLlm = withSet('nli-then-llm');
  const headline = pick(deep, PROVISIONAL_VERIFIER_STRATEGY);
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
    attributionK: ATTRIBUTION_K,
    verifierStrategy: PROVISIONAL_VERIFIER_STRATEGY,
    metrics: {
      citationValidity: citationValidity([...light.asked, ...headline]),
      contradictionSet: contradictionSet(headline),
      retrievalRecall: retrievalRecall(retrievals, RETRIEVAL_K),
      misspeltRetrievalRecall: misspeltRetrievalRecall(misspelt, RETRIEVAL_K),
      verifierPrecision: headlineAccuracy.precision,
      verifierRecall: headlineAccuracy.recall,
      examAnswerability: notMeasurable(NOT_YET.exams),
      gradingAgreement: notMeasurable(NOT_YET.marks),
      derivedTextCoverage: notMeasurable(NOT_YET.derived),
      derivedTextRecall: notMeasurable(NOT_YET.derived),
      derivedTextPrecision: notMeasurable(NOT_YET.derived),
      attributionRecall: attributionRecall(light.asked),
      contradictionSetLight: contradictionSetLight(light.asked),
      lightFlagRate: lightFlagRate(light.asked),
      lightFlagRateWide: lightFlagRate(wide),
      sentenceKindPrecision: kinds.precision,
      sentenceKindRecall: kinds.recall,
      ...summaryRows(summaries),
      tagRecall: tagRecall(spec.topicLabels, tagged),
    },
    depths: {
      light: {
        explanationWithheld: explanationWithheld(light.asked),
        quotedShare: quotedShare(light.asked),
      },
      deep: {
        explanationWithheld: explanationWithheld(headline),
        explanationEntailed: explanationEntailed(headline),
        quotedShare: quotedShare(headline),
      },
    },
    attribution: attributionCounts(light.asked, light.overLengthPairs),
    verifierArms: { nli, llm, nliThenLlm, ...verifierArmDecisions({ nli, llm, nliThenLlm }) },
    latency: {
      ask: latencySummary([...light.durationsMs], 'no golden question was asked'),
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
