import { CourseId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { followUp } from './eval-fixture';
import { RecordingGateway } from './recording-gateway';
import { type EvalRunSpec, runEval } from './run-eval';
import { indexedLecture, record } from './run-fixture';
import { ScriptedGateway, scriptedReplay } from './scripted-gateway-fixture';
import { tutor } from './scripted-tutor-fixture';

const LECTURES = [
  indexedLecture('l1', [
    record({ slideNo: 1, title: 'Comb', body: 'Bees build comb from square cells.' }),
    record({ slideNo: 2, title: 'Drones', body: 'Drones are larger than workers.' }),
  ]),
];

const ITEM = followUp({
  turns: [{ question: 'What are drones?', answer: 'Drones are larger than workers.' }],
  question: 'Are they larger than workers?',
  standalone: 'Are drones larger than workers?',
  expectedCitations: [{ lectureId: 'l1', slideNo: 2 }],
});

const spec = (gateway: EvalRunSpec['gateway']): EvalRunSpec => ({
  facts: { measuredCommit: 'abc1234', pullRequest: 1, machineClass: 'dev-apple-silicon' },
  courseId: CourseId.parse('hollowmere'),
  lectures: LECTURES,
  questions: [],
  followUps: [ITEM],
  labels: [],
  sentenceKinds: [],
  topicLabels: [],
  gateway,
  clock: () => 0,
});

/** `docs/adr/0011-ask-conversation.md` § Decision (g): tier 2 runs the rewrite, both retrievals and the light ask; tier 1 replays them. */
describe('runEval over a follow-up', () => {
  it('measures both follow-up rows from one rewrite, and replays to the same report', async () => {
    const recorder = new RecordingGateway({ inner: new ScriptedGateway(tutor(false)) });
    const report = await runEval(spec(recorder));
    const recorded = recorder.recordings();
    if (recorded.status !== 'recorded') throw new Error('the scripted run was nondeterministic');
    expect(report.metrics.followUpRetrieval).toEqual({
      status: 'measured',
      bar: 'baseline',
      ratio: { numerator: 1, denominator: 1 },
      failures: [],
    });
    expect(report.metrics.followUpAttributionRecall).toMatchObject({
      status: 'measured',
      ratio: { numerator: 1, denominator: 1 },
    });
    const rewrites = recorded.recordings.filter(
      (recording) =>
        recording.role === 'generator' && recording.request.output.name === 'standalone-question',
    );
    expect(rewrites).toHaveLength(1);
    await expect(runEval(spec(scriptedReplay(recorded.recordings)))).resolves.toEqual(report);
  });
});
