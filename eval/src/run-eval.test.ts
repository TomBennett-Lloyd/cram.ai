import {
  FakeGateway,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
  RecordingMissError,
} from '@cram/gateway';
import { ATTRIBUTION_K } from '@cram/index';
import { CourseId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { kindLabel, label, question, topicLabel } from './eval-fixture';
import { RecordingGateway } from './recording-gateway';
import { runEval, type EvalRunSpec } from './run-eval';
import { indexedLecture as lecture, record } from './run-fixture';
import { type Respond, SAMPLING, ScriptedGateway, SERVED } from './scripted-gateway-fixture';
import { credulous, tutor } from './scripted-tutor-fixture';

const COURSE = CourseId.parse('hollowmere');

const LECTURES = [
  lecture('l1', [
    record({
      lectureId: 'l1',
      slideNo: 1,
      title: 'Comb',
      body: 'Bees build comb from square cells.',
    }),
    record({ lectureId: 'l1', slideNo: 2, title: 'Workers', body: 'Worker bees are male.' }),
  ]),
  lecture('l2', [
    record({ lectureId: 'l2', slideNo: 1, title: 'Colour', body: 'Foragers see red best.' }),
  ]),
];

const QUESTIONS = [
  question({
    question: 'What shape are comb cells?',
    expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
    mustNotContain: ['hexagon'],
  }),
  question({
    question: 'Are worker bees male?',
    expectedCitations: [{ lectureId: 'l1', slideNo: 2 }],
    mustNotContain: ['female'],
    misspelt: ['Are wrker bees male?', 'Are wroker bees male?', 'Are wkr bees male?'],
  }),
  question({ question: 'Who won the football cup?', expectedCitations: [], mustNotContain: [] }),
];

const LABELS = [
  label({
    text: 'Bees build comb from square cells.',
    quotes: ['Bees build comb from square cells.'],
    verdict: 'supported',
  }),
  label({
    text: 'Bees build round cells.',
    quotes: ['Bees build comb from square cells.'],
    verdict: 'unsupported',
  }),
];

const SENTENCE_KINDS = [
  kindLabel({
    sentence: 'So a comb is a sheet of cells.',
    premises: [{ lectureId: 'l1', slideNo: 1 }],
    kind: 'interpretation',
  }),
  kindLabel({
    sentence: 'So workers forage.',
    premises: [{ lectureId: 'l1', slideNo: 1 }],
    kind: 'course-claim',
  }),
  kindLabel({
    sentence: 'So a forager is a worker that gathers.',
    premises: [{ lectureId: 'l2', slideNo: 1 }],
    kind: 'interpretation',
  }),
  kindLabel({
    sentence: 'A cell is one compartment of a comb.',
    premises: [{ lectureId: 'l1', slideNo: 1 }],
    kind: 'interpretation',
  }),
];

const TOPICS = [
  topicLabel({ lectureId: 'l1', slideNo: 1, tags: ['comb'] }),
  topicLabel({ lectureId: 'l1', slideNo: 2, tags: ['workers', 'castes'] }),
];

const steppingClock = () => {
  let now = 0;
  return () => (now += 1);
};

/** A slide whose whole text is over the scripted cross-encoder's length. */
const LONG = record({
  lectureId: 'l3',
  slideNo: 1,
  title: 'Propolis',
  body: `Propolis is gathered from poplar buds.\n${'It seals every gap in the hive. '.repeat(8)}`,
});
const spec = (
  gateway: EvalRunSpec['gateway'],
  overrides: Partial<EvalRunSpec> = {},
): EvalRunSpec => ({
  facts: {
    measuredCommit: 'abc1234',
    pullRequest: 1,
    machineClass: 'dev-apple-silicon',
  },
  courseId: COURSE,
  lectures: LECTURES,
  questions: QUESTIONS,
  labels: LABELS,
  sentenceKinds: SENTENCE_KINDS,
  topicLabels: TOPICS,
  gateway,
  clock: steppingClock(),
  ...overrides,
});

const recordRun = async (respond: Respond, overrides: Partial<EvalRunSpec> = {}) => {
  const recorder = new RecordingGateway({ inner: new ScriptedGateway(respond) });
  const report = await runEval(spec(recorder, overrides));
  const recorded = recorder.recordings();
  if (recorded.status !== 'recorded') throw new Error('the scripted run was nondeterministic');
  return { report, recordings: recorded.recordings };
};

const replay = (recordings: readonly Recording[]) =>
  new FakeGateway({
    pins: PROVISIONAL_DEFAULT_PINS,
    sampling: SAMPLING,
    served: SERVED,
    recordings,
  });

describe('runEval', () => {
  it('replays its own recordings over FakeGateway to the same report', async () => {
    const live = await recordRun(tutor(false));
    await expect(runEval(spec(replay(live.recordings)))).resolves.toEqual(live.report);
  });

  it('measures every metric it has inputs for, over the whole pipeline', async () => {
    const { report } = await recordRun(tutor(false));
    expect(report.metrics).toMatchObject({
      citationValidity: { status: 'measured', ratio: { numerator: 4, denominator: 4 } },
      contradictionSet: { status: 'measured', ratio: { numerator: 3, denominator: 3 } },
      retrievalRecall: { status: 'measured', ratio: { numerator: 2, denominator: 2 } },
      misspeltRetrievalRecall: { status: 'measured', ratio: { numerator: 3, denominator: 3 } },
      verifierPrecision: { status: 'measured', ratio: { numerator: 1, denominator: 1 } },
      verifierRecall: { status: 'measured', ratio: { numerator: 1, denominator: 1 } },
    });
    expect(report.attributionK).toBe(ATTRIBUTION_K);
    expect(report.metrics).toMatchObject({
      attributionRecall: { status: 'measured', ratio: { numerator: 2, denominator: 2 } },
      contradictionSetLight: { status: 'measured', ratio: { numerator: 3, denominator: 3 } },
      lightFlagRate: { status: 'not-measurable' },
      lightFlagRateWide: { status: 'not-measurable' },
      summaryYield: { status: 'measured', ratio: { numerator: 2, denominator: 2 } },
      tagRecall: { status: 'measured', ratio: { numerator: 2, denominator: 3 } },
      summaryUnitYield: { status: 'measured', ratio: { numerator: 3, denominator: 3 } },
    });
    expect(report.attribution).toEqual({ answers: 2, sentences: 2, pairs: 6, overLengthPairs: 0 });
    expect(report.pins).toEqual({ ...PROVISIONAL_DEFAULT_PINS, reranker: null });
    expect(report.servedGenerator).toEqual(SERVED);
    expect(report.verifierArms).toMatchObject({
      crossEncoderPrimary: { status: 'tied' },
      secondOpinion: { status: 'drop', failed: 'recall' },
    });
  });

  it('records the sampling its generator reports, which no caller passes', async () => {
    const reseeded = { ...SAMPLING, seed: 7 };
    const report = await runEval(spec(new ScriptedGateway(tutor(false), null, reseeded)));
    expect(report.determinism).toEqual({ generator: reseeded });
  });

  it('reports the metrics with no input yet as not-measurable', async () => {
    const { report } = await recordRun(tutor(false));
    for (const row of [
      report.metrics.examAnswerability,
      report.metrics.gradingAgreement,
      report.metrics.derivedTextCoverage,
      report.metrics.derivedTextRecall,
      report.metrics.derivedTextPrecision,
      report.latency.generatorTimeToFirstToken,
      report.latency.generatorTokensPerSecond,
    ])
      expect(row.status).toBe('not-measurable');
  });

  it('carries per-item contradiction-set failures through to the report', async () => {
    const { report } = await recordRun(tutor(true));
    expect(report.metrics.contradictionSet).toMatchObject({
      ratio: { numerator: 2, denominator: 3 },
      failures: [
        { question: 'Who won the football cup?', problems: [{ kind: 'answered-uncovered' }] },
      ],
    });
  });

  it('headlines the shipping strategy, where it and the cross-encoder alone disagree', async () => {
    const { report } = await recordRun(credulous, {
      lectures: [...LECTURES, lecture('l3', [LONG])],
      questions: [
        ...QUESTIONS,
        question({
          question: 'Where is propolis gathered?',
          expectedCitations: [{ lectureId: 'l3', slideNo: 1 }],
          mustNotContain: ['resin'],
        }),
      ],
      labels: [
        ...LABELS,
        label({
          text: 'Bees build comb from square cells. Bees build round cells.',
          quotes: ['Bees build comb from square cells.'],
          verdict: 'partial',
        }),
      ],
    });
    const { nli, nliThenLlm } = report.verifierArms;
    expect(report.verifierStrategy).toBe('nli-then-llm');
    expect(nli.contradictionSet).toMatchObject({
      ratio: { numerator: 3, denominator: 4 },
      failures: [{ question: 'Where is propolis gathered?' }],
    });
    expect(nliThenLlm.contradictionSet).toMatchObject({ ratio: { numerator: 4, denominator: 4 } });
    expect(report.metrics.contradictionSet).toEqual(nliThenLlm.contradictionSet);
    expect(report.attribution.overLengthPairs).toBeGreaterThan(0);
    expect(report.attribution.pairs).toBeLessThan(4 * report.attribution.sentences);
    expect(nli.accuracy.precision).not.toEqual(nliThenLlm.accuracy.precision);
    expect(report.metrics.verifierPrecision).toEqual(nliThenLlm.accuracy.precision);
  });

  it('times each golden question once, under the shipping strategy only', async () => {
    const { report } = await recordRun(tutor(false));
    expect(report.latency.ask).toMatchObject({ samples: QUESTIONS.length });
    expect(report.verifierArms.nli.perUnitLatency).toMatchObject({ samples: LABELS.length });
  });

  it('retrieves each misspelt variant as typed or corrected, and never asks one', async () => {
    const { recordings } = await recordRun(tutor(false));
    const sent = (role: string) =>
      recordings.filter((r) => r.role === role).map(({ request }) => JSON.stringify(request));
    expect(sent('embedder').some((text) => text.includes('Are wkr bees male?'))).toBe(true);
    expect(sent('generator').some((text) => text.includes('Are worker bees male?'))).toBe(true);
    expect(sent('generator').some((text) => /wrker|wroker|wkr/.test(text))).toBe(false);
  });

  it('counts recall at the retrieval k, not only the top slide', async () => {
    const { report } = await recordRun(tutor(false), {
      questions: [
        question({
          question: 'What do bees build, and are workers male?',
          expectedCitations: [
            { lectureId: 'l1', slideNo: 1 },
            { lectureId: 'l1', slideNo: 2 },
            { lectureId: 'l2', slideNo: 1 },
          ],
        }),
      ],
    });
    expect(report.metrics.retrievalRecall).toMatchObject({
      ratio: { numerator: 3, denominator: 3 },
    });
  });

  it('judges each sentence-kind label against its premises’ slide text, interpretation the positive class', async () => {
    const { report } = await recordRun(tutor(false));
    expect(report.metrics).toMatchObject({
      sentenceKindPrecision: { status: 'measured', ratio: { numerator: 1, denominator: 2 } },
      sentenceKindRecall: { status: 'measured', ratio: { numerator: 1, denominator: 3 } },
    });
  });

  it('rejects a sentence-kind label whose premise is not in the course', async () => {
    const stray = kindLabel({ premises: [{ lectureId: 'l1', slideNo: 9 }] });
    await expect(
      runEval(spec(new ScriptedGateway(tutor(false)), { sentenceKinds: [stray] })),
    ).rejects.toThrow('no slide l1#9 for a sentence-kind label');
  });

  it('rejects a hand label with no quote rather than verifying it against nothing', async () => {
    await expect(
      runEval(spec(new ScriptedGateway(tutor(false)), { labels: [{ ...label(), quotes: [] }] })),
    ).rejects.toThrow('a hand label has no quote');
  });

  it('rejects on a replay miss rather than reporting', async () => {
    const { recordings } = await recordRun(tutor(false));
    const lastGenerator = recordings.findLastIndex(({ role }) => role === 'generator');
    const short = recordings.filter((_, index) => index !== lastGenerator);
    await expect(runEval(spec(replay(short)))).rejects.toBeInstanceOf(RecordingMissError);
  });
});
