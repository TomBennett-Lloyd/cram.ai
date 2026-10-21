import {
  type ChatWireRequest,
  FakeGateway,
  type GeneratorReply,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
  RecordingMissError,
} from '@cram/gateway';
import { CourseId, Deck, type SlideRecord } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { label, question } from './eval-fixture';
import type { IndexedLecture } from './index-retriever';
import { RecordingGateway } from './recording-gateway';
import { runEval, type EvalRunSpec } from './run-eval';
import { record } from './run-fixture';
import { type Respond, SAMPLING, ScriptedGateway, SERVED } from './scripted-gateway-fixture';

const COURSE = CourseId.parse('hollowmere');

const lecture = (lectureId: string, slides: readonly SlideRecord[]): IndexedLecture => ({
  deck: Deck.parse({
    lectureId,
    lectureTitle: `Lecture ${lectureId}`,
    mediaType: 'application/pdf',
    content: new TextEncoder().encode(`deck ${lectureId}`),
  }),
  slides,
});

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

const StatementBlock = z.strictObject({ quotes: z.array(z.string()), statement: z.string() });

const words = (text: string): readonly string[] => text.toLowerCase().match(/[a-z]{5,}/g) ?? [];

const content = (value: unknown): GeneratorReply => ({
  status: 'content',
  content: JSON.stringify(value),
});

interface Source {
  readonly id: string;
  readonly line: string;
  readonly text: string;
}

const sourcesOf = (prompt: string): readonly Source[] =>
  [...prompt.matchAll(/<source id="([^"]+)">\n([\s\S]*?)\n<\/source>/g)].map(([, id, text]) => ({
    id: id ?? '',
    text: text ?? '',
    line: (text ?? '').split('\n')[1] ?? '',
  }));

/** Answers from each source sharing a long word with the question, or from every source when `eager`. */
const tutor =
  (eager: boolean): Respond =>
  (wire: ChatWireRequest) => {
    const prompt = wire.messages.at(-1)?.content ?? '';
    switch (wire.output.name) {
      case 'units': {
        const asked = words(/<question>(.*)<\/question>/.exec(prompt)?.[1] ?? '');
        const units = sourcesOf(prompt)
          .filter(({ text }) => eager || words(text).some((word) => asked.includes(word)))
          .map(({ id, line }) => ({ text: line, citations: [{ sourceId: id, quote: line }] }));
        return content({ units });
      }
      case 'verdict': {
        const { quotes, statement } = StatementBlock.parse(JSON.parse(prompt));
        return content({
          verdict: quotes.join(' ').includes(statement) ? 'supported' : 'unsupported',
        });
      }
      default:
        return { status: 'backend-failed', reason: `unscripted output ${wire.output.name}` };
    }
  };

const steppingClock = () => {
  let now = 0;
  return () => (now += 1);
};

/** Says every statement is supported, and lets each source line also say comb cells are hexagons. */
const credulous: Respond = (wire) => {
  if (wire.output.name === 'verdict') return content({ verdict: 'supported' });
  const reply = tutor(false)(wire);
  if (wire.output.name !== 'units' || reply.status !== 'content') return reply;
  const { units } = z
    .strictObject({ units: z.array(z.strictObject({ text: z.string() }).loose()) })
    .parse(JSON.parse(reply.content));
  return content({
    units: units.map((unit) => ({ ...unit, text: `${unit.text} Comb cells are hexagons.` })),
  });
};

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
      citationValidity: { status: 'measured', ratio: { numerator: 2, denominator: 2 } },
      contradictionSet: { status: 'measured', ratio: { numerator: 3, denominator: 3 } },
      retrievalRecall: { status: 'measured', ratio: { numerator: 2, denominator: 2 } },
      verifierPrecision: { status: 'measured', ratio: { numerator: 1, denominator: 1 } },
      verifierRecall: { status: 'measured', ratio: { numerator: 1, denominator: 1 } },
    });
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
    expect(nli.contradictionSet).not.toEqual(nliThenLlm.contradictionSet);
    expect(report.metrics.contradictionSet).toEqual(nliThenLlm.contradictionSet);
    expect(nli.accuracy.precision).not.toEqual(nliThenLlm.accuracy.precision);
    expect(report.metrics.verifierPrecision).toEqual(nliThenLlm.accuracy.precision);
  });

  it('times each golden question once, under the shipping strategy only', async () => {
    const { report } = await recordRun(tutor(false));
    expect(report.latency.ask).toMatchObject({ samples: QUESTIONS.length });
    expect(report.verifierArms.nli.perUnitLatency).toMatchObject({ samples: LABELS.length });
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
