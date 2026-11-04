import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ingestedCourse } from './ingested-course';
import { passed } from './metric-row';
import { EVAL_COURSE_ID, EVAL_ROOT, readEvalCourse } from './read-eval-course';
import { replayRun } from './replay-run';
import { readRun } from './run-files';
import { replayMismatches, unreadRunMessage } from './tier-one-mismatch';

// Tier 1 over the committed tier-2 run (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)).
// Each failure names its `TierOneMismatch` kind; any of them means re-run `pnpm eval` (#460).
const course = readEvalCourse();
if (course.status !== 'read') throw new Error(`${course.where}: ${course.message}`);
const read = readRun(EVAL_ROOT);
if (read.status !== 'read') throw new Error(unreadRunMessage(read));
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
      const replay = replayRun({
        run,
        courseId: EVAL_COURSE_ID,
        course: course.course,
        lectures: await ingestedCourse(course.course.deck, EVAL_COURSE_ID, dir),
      });
      expect(await replayMismatches(run.report, replay)).toEqual([]);
    },
    RENDER_AND_REPLAY_BOUND_MS,
  );

  it('holds citation validity at its bar', () => {
    expect(passed(run.report.metrics.citationValidity)).toBe(true);
  });

  // `CLAUDE.md` § Hard constraints, "The slides win"; `metrics.contradictionSet` is the deep run's.
  it('holds the contradiction set at its bar', () => {
    expect(passed(run.report.metrics.contradictionSet)).toBe(true);
  });
});
