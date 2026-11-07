import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatRequest, Generator } from '@cram/gateway';
import {
  PROVISIONAL_NLI_THRESHOLDS,
  PROVISIONAL_VERIFIER_STRATEGY,
  summariseLecture,
} from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import { describe, it } from 'vitest';
import { ingestedCourse } from './ingested-course';
import { liveConfig } from './live-config';
import { openLiveGateway } from './live-gateway';
import { measuredCommit } from './measured-commit';
import { EVAL_COURSE_ID, EVAL_ROOT, readEvalCourse } from './read-eval-course';
import { keyTotals, type LectureKeyRow, LooseUnits, lectureKeyRow } from './summary-key';

// The summary stage alone, through the live gateway, for #481's citation-key measurement; skipped under
// `pnpm test`. Set CRAM_SUMMARY_KEY=1 and the backend variables `live-run.measure.test.ts`'s header names.
const env = process.env;
const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const capturing = (inner: Generator, replies: LooseUnits[]): Generator => ({
  pin: inner.pin,
  sampling: inner.sampling,
  maxOutputTokens: inner.maxOutputTokens,
  served: inner.served,
  chat: async <T>(request: ChatRequest<T>) => {
    const result = await inner.chat(request);
    if (result.status === 'completed') {
      const read = LooseUnits.safeParse(result.value);
      if (read.success) replies.push(read.data);
    }
    return result;
  },
});

describe.runIf(env.CRAM_SUMMARY_KEY === '1')('summary key', () => {
  it(
    'summarises each eval lecture and prints how its citations resolved',
    async () => {
      const configured = liveConfig(env);
      if (configured.status !== 'configured') throw new Error(configured.message);
      const opened = await openLiveGateway(configured.config);
      if (opened.status !== 'open')
        throw new Error(`${opened.role} did not load: ${opened.reason}: ${opened.detail}`);
      const read = readEvalCourse();
      if (read.status !== 'read') throw new Error(`${read.where}: ${read.message}`);
      const dir = await mkdtemp(join(tmpdir(), 'cram-summary-key-481-'));
      try {
        const rows: LectureKeyRow[] = [];
        for (const { deck, slides } of await ingestedCourse(
          read.course.deck,
          EVAL_COURSE_ID,
          dir,
        )) {
          const replies: LooseUnits[] = [];
          const retrieved = [...slides]
            .sort((a, b) => a.slideNo - b.slideNo)
            .map((record) => ({ sourceId: sourceIdOf(record), record }));
          const outcome = await summariseLecture(deck, retrieved, {
            gateway: { ...opened.gateway, generator: capturing(opened.gateway.generator, replies) },
            strategy: PROVISIONAL_VERIFIER_STRATEGY,
            thresholds: PROVISIONAL_NLI_THRESHOLDS,
          });
          rows.push(lectureKeyRow(deck.lectureId, retrieved, replies, outcome));
        }
        console.log(
          JSON.stringify({ measured: measuredCommit(EVAL_ROOT), rows, totals: keyTotals(rows) }),
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT_MS,
  );
});
