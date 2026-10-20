import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CourseId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ingestedCourse } from './ingested-course';
import { liveConfig } from './live-config';
import { openLiveGateway } from './live-gateway';
import { EVAL_ROOT, readEvalCourse } from './read-eval-course';
import { RecordingGateway } from './recording-gateway';
import { MachineClass } from './report';
import { runEval } from './run-eval';
import { writeRun } from './run-files';

// `pnpm eval`: tier 2 (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)), skipped under `pnpm test`.
// CRAM_EVAL_PR=<this PR> CRAM_MACHINE_CLASS=<MachineClass> CRAM_MODELS_DIR=<encoder snapshots> \
//   CRAM_GENERATOR_ENDPOINT=… CRAM_GENERATOR_MODEL=… pnpm eval      (the last two as `pnpm models:pull` prints them)
const env = process.env;
const RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const COURSE = CourseId.parse('hollowmere');

const RunFacts = z.object({
  CRAM_EVAL_PR: z.coerce.number().int().positive(),
  CRAM_MACHINE_CLASS: MachineClass,
});

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: EVAL_ROOT, encoding: 'utf8' }).trim();

describe.runIf(env.CRAM_EVAL === '1')('pnpm eval', () => {
  it(
    'runs the course through the live gateway and writes its report and recordings',
    async () => {
      expect(
        git('status', '--porcelain', '--untracked-files=no'),
        'a report names the commit it measured, so the tree must be HEAD',
      ).toBe('');
      const facts = RunFacts.parse(env);
      const configured = liveConfig(env);
      if (configured.status !== 'configured') throw new Error(configured.message);
      const opened = await openLiveGateway(configured.config);
      if (opened.status !== 'open')
        throw new Error(`${opened.role} did not load: ${opened.reason}: ${opened.detail}`);
      const read = readEvalCourse();
      if (read.status !== 'read') throw new Error(`${read.where}: ${read.message}`);
      const dir = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));
      try {
        const sampling = configured.config.generator.sampling;
        const recorder = new RecordingGateway({ inner: opened.gateway, sampling });
        const report = await runEval({
          facts: {
            measuredCommit: git('rev-parse', '--short', 'HEAD'),
            pullRequest: facts.CRAM_EVAL_PR,
            machineClass: facts.CRAM_MACHINE_CLASS,
            sampling,
          },
          courseId: COURSE,
          lectures: await ingestedCourse(read.course.deck, COURSE, dir),
          questions: read.course.questions,
          labels: read.course.labels,
          gateway: recorder,
          clock: () => performance.now(),
        });
        const recorded = recorder.recordings();
        if (recorded.status === 'nondeterministic')
          throw new Error(
            `one call answered two ways; re-run: ${JSON.stringify(recorded.first)} ${JSON.stringify(recorded.second.reply)}`,
          );
        await writeRun(EVAL_ROOT, { report, recordings: recorded.recordings });
        console.log(JSON.stringify(report.metrics, null, 2));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT_MS,
  );
});
