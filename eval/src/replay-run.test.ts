import {
  type ChatWireRequest,
  type GeneratorReply,
  GeneratorPin,
  RecordingMissError,
} from '@cram/gateway';
import { CourseId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { course, label, question } from './eval-fixture';
import { LIVE_PINS, LIVE_SAMPLING } from './live-config';
import { RecordingGateway } from './recording-gateway';
import { replayRun, untimed } from './replay-run';
import { runEval } from './run-eval';
import type { EvalRun } from './run-files';
import { indexedLecture, record } from './run-fixture';
import { ScriptedGateway } from './scripted-gateway-fixture';

const COURSE_ID = CourseId.parse('hollowmere');

const LECTURES = [
  indexedLecture('l1', [
    record(),
    record({ slideNo: 2, title: 'Workers', body: 'Workers are male.' }),
  ]),
];

const COURSE = course({
  questions: [question(), question({ question: 'Who won the cup?', expectedCitations: [] })],
  labels: [label(), label({ text: 'Cells are round.', verdict: 'unsupported' })],
});

/** Covers nothing and supports every statement: enough to make every role answer. */
const respond = (wire: ChatWireRequest): GeneratorReply => ({
  status: 'content',
  content: JSON.stringify(wire.output.name === 'units' ? { units: [] } : { verdict: 'supported' }),
});

/** A live run of `COURSE` over the scripted gateway, timed by a clock that moves. */
const liveRun = async (): Promise<EvalRun> => {
  const recorder = new RecordingGateway({
    inner: new ScriptedGateway(respond, null, LIVE_SAMPLING),
  });
  let now = 0;
  const report = await runEval({
    facts: {
      measuredCommit: 'abc1234',
      pullRequest: 7,
      machineClass: 'dev-apple-silicon',
    },
    courseId: COURSE_ID,
    lectures: LECTURES,
    questions: COURSE.questions,
    labels: COURSE.labels,
    gateway: recorder,
    clock: () => (now += 3),
  });
  const recorded = recorder.recordings();
  if (recorded.status !== 'recorded') throw new Error('the scripted run was nondeterministic');
  return { report, recordings: recorded.recordings };
};

const replay = (run: EvalRun) =>
  replayRun({ run, courseId: COURSE_ID, course: COURSE, lectures: LECTURES });

describe('replayRun', () => {
  it('reproduces the live report from its recordings in all but wall-clock time', async () => {
    const run = await liveRun();
    const replayed = await replay(run);
    expect(untimed(replayed)).toEqual(untimed(run.report));
    expect(replayed.latency.ask).not.toEqual(run.report.latency.ask);
  });

  it('carries the run’s commit, PR and machine class into the replayed report', async () => {
    const run = await liveRun();
    await expect(replay(run)).resolves.toMatchObject({
      measuredCommit: 'abc1234',
      pullRequest: 7,
      machineClass: 'dev-apple-silicon',
    });
  });

  it('misses, rather than replays, a run recorded under another pin', async () => {
    const run = await liveRun();
    const repinned = GeneratorPin.parse({ ...LIVE_PINS.generator, model: 'Qwen/Qwen3-8B' });
    const recordings = run.recordings.map((recording) =>
      recording.role === 'generator' ? { ...recording, pin: repinned } : recording,
    );
    await expect(replay({ ...run, recordings })).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('misses, rather than replays, a run recorded under other sampling', async () => {
    const run = await liveRun();
    const recordings = run.recordings.map((recording) =>
      recording.role === 'generator'
        ? { ...recording, sampling: { temperature: 0, seed: 1 } }
        : recording,
    );
    await expect(replay({ ...run, recordings })).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('misses when a question was asked that the run never recorded', async () => {
    const run = await liveRun();
    const asked = course({
      ...COURSE,
      questions: [...COURSE.questions, question({ question: 'Are drones idle?' })],
    });
    await expect(
      replayRun({ run, courseId: COURSE_ID, course: asked, lectures: LECTURES }),
    ).rejects.toBeInstanceOf(RecordingMissError);
  });
});

describe('untimed', () => {
  it('keeps how many calls were timed, and drops how long they took', async () => {
    const { report } = await liveRun();
    expect(untimed(report).latency.perCall.embedder).toEqual({ status: 'measured', samples: 3 });
  });
});
