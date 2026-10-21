import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ingestedCourse } from './ingested-course';
import { passed } from './metric-row';
import { EVAL_COURSE_ID, EVAL_ROOT, readEvalCourse } from './read-eval-course';
import { replayRun, untimed } from './replay-run';
import { readRun } from './run-files';

// Tier 1 over the committed tier-2 run (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)).
// A miss here means the pipeline asks something the run never recorded: re-run `pnpm eval`.
const course = readEvalCourse();
if (course.status !== 'read') throw new Error(`${course.where}: ${course.message}`);
const read = readRun(EVAL_ROOT);
if (read.status !== 'read') throw new Error(`${read.where}: ${read.message}`);
const { run } = read;

const RENDER_AND_REPLAY_BOUND_MS = 120_000;

const dir = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the committed tier-2 run', () => {
  it(
    'replays to its own report, less wall-clock time',
    async () => {
      const replayed = await replayRun({
        run,
        courseId: EVAL_COURSE_ID,
        course: course.course,
        lectures: await ingestedCourse(course.course.deck, EVAL_COURSE_ID, dir),
      });
      expect(untimed(replayed)).toEqual(untimed(run.report));
    },
    RENDER_AND_REPLAY_BOUND_MS,
  );

  // The contradiction set's assertion joins this one when #216 is fixed and the run re-recorded.
  it('holds citation validity at its bar', () => {
    expect(passed(run.report.metrics.citationValidity)).toBe(true);
  });
});
