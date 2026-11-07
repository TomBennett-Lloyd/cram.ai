import { CourseId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { runEval } from './run-eval';
import { indexedLecture, record } from './run-fixture';
import {
  type Respond,
  SCRIPTED_MAX_OUTPUT_TOKENS,
  ScriptedGateway,
} from './scripted-gateway-fixture';
import { credulous } from './scripted-tutor-fixture';

const run = (respond: Respond) =>
  runEval({
    facts: { measuredCommit: 'abc1234', pullRequest: 1, machineClass: 'dev-apple-silicon' },
    courseId: CourseId.parse('hollowmere'),
    lectures: ['l1', 'l2'].map((lectureId) =>
      indexedLecture(lectureId, [record({ lectureId, slideNo: 1, body: 'Bees build comb.' })]),
    ),
    questions: [],
    followUps: [],
    labels: [],
    sentenceKinds: [],
    topicLabels: [],
    gateway: new ScriptedGateway(respond),
    clock: () => 0,
  });

describe('runEval', () => {
  it('reports the generator replies cut off, by what stopped them', async () => {
    const cutSummaries: Respond = (wire) =>
      wire.output.name === 'units'
        ? { status: 'truncated', content: '{"units":[', cutOffAt: 'timeout' }
        : credulous(wire);
    await expect(run(cutSummaries)).resolves.toMatchObject({
      generatorCutOffs: { maxOutputTokens: SCRIPTED_MAX_OUTPUT_TOKENS, tokenLimit: 0, timeout: 2 },
    });
    await expect(run(credulous)).resolves.toMatchObject({
      generatorCutOffs: { tokenLimit: 0, timeout: 0 },
    });
  });
});
