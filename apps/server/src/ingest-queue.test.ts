import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseId, LectureId } from '@cram/shared';
import type { ChatRequest, ChatResult } from '@cram/gateway';
import { afterEach, describe, expect, it } from 'vitest';
import { IngestQueue } from './ingest-queue';
import type { LogEntry } from './server-log';
import { HIVE, seededDataDir } from './repair-fixture';
import { FailingEmbedder, gatewayOf, pdfDeck, WordEmbedder } from './server-fixture';
import { embedderIdentity } from './slide-embedding';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('IngestQueue.remake', () => {
  it('reports a re-make of a lecture the course file no longer holds as failed, storing nothing', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cram-queue-'));
    dirs.push(dataDir);
    const files = { dataDir, embedder: await embedderIdentity(new WordEmbedder()) };
    const logs: LogEntry[] = [];
    const queue = new IngestQueue({ files, gateway: gatewayOf([]) }, (entry) => logs.push(entry));
    const bio = CourseId.parse('bio');
    expect(queue.remake(bio, LectureId.parse('l1'))).toEqual({
      lectureId: 'l1',
      progress: { state: 'queued' },
    });
    await queue.idle();
    expect(queue.remakes(bio)).toEqual([{ lectureId: 'l1', progress: { state: 'failed' } }]);
    expect(logs).toEqual([]);
  });

  it('reports a re-make whose summary job throws as failed, logging the lecture it concerns', async () => {
    const dataDir = await seededDataDir();
    dirs.push(dataDir);
    const files = { dataDir, embedder: await embedderIdentity(new WordEmbedder()) };
    const fake = gatewayOf([]);
    const generator = { ...fake.generator, chat: () => Promise.reject(new TypeError('broken')) };
    const logs: LogEntry[] = [];
    const queue = new IngestQueue({ files, gateway: { ...fake, generator } }, (entry) =>
      logs.push(entry),
    );
    const bio = CourseId.parse('bio');
    queue.remake(bio, LectureId.parse('l1'));
    await queue.idle();
    expect(queue.remakes(bio)).toEqual([{ lectureId: 'l1', progress: { state: 'failed' } }]);
    expect(logs).toEqual([
      { operation: 'summarise', courseId: 'bio', lectureKey: 1, outcome: 'TypeError' },
    ]);
  });

  it('reports a re-make running while its summary call is out, then done', async () => {
    const dataDir = await seededDataDir();
    dirs.push(dataDir);
    const files = { dataDir, embedder: await embedderIdentity(new WordEmbedder()) };
    const fake = gatewayOf([]);
    let called: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      called = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generator = {
      ...fake.generator,
      chat: async <T>(request: ChatRequest<T>): Promise<ChatResult<T>> => {
        called();
        await gate;
        return fake.generator.chat(request);
      },
    };
    const queue = new IngestQueue({ files, gateway: { ...fake, generator } }, () => undefined);
    const bio = CourseId.parse('bio');
    queue.remake(bio, LectureId.parse('l1'));
    await reached;
    expect(queue.remakes(bio)).toEqual([{ lectureId: 'l1', progress: { state: 'running' } }]);
    release();
    await queue.idle();
    expect(queue.remakes(bio)).toEqual([
      { lectureId: 'l1', progress: { state: 'done', summarised: false } },
    ]);
  });
});

describe('IngestQueue’s log', () => {
  it('names each lecture job by the stored lecture’s own key, kept across a re-upload', async () => {
    const dataDir = await seededDataDir();
    dirs.push(dataDir);
    const files = { dataDir, embedder: await embedderIdentity(new WordEmbedder()) };
    const bio = CourseId.parse('bio');
    const l2 = LectureId.parse('l2');
    const job = {
      courseId: bio,
      lectureId: l2,
      fileName: 'hive.pdf',
      mediaType: 'application/pdf' as const,
      bytes: await pdfDeck(HIVE),
    };
    const storing = new IngestQueue({ files, gateway: gatewayOf([]) }, () => undefined);
    storing.enqueue(job);
    await storing.idle();

    const fake = gatewayOf([]);
    const throwing = { ...fake.generator, chat: () => Promise.reject(new TypeError('broken')) };
    const logs: LogEntry[] = [];
    const log = (entry: LogEntry) => logs.push(entry);
    const rejecting = new IngestQueue({ files, gateway: { ...fake, generator: throwing } }, log);
    rejecting.enqueue(job);
    rejecting.remake(bio, l2);
    await rejecting.idle();
    const down = {
      ...fake.generator,
      chat: <T>(): Promise<ChatResult<T>> =>
        Promise.resolve({ status: 'backend-failed', reason: 'connection refused' }),
    };
    const unanswered = new IngestQueue({ files, gateway: { ...fake, generator: down } }, log);
    unanswered.remake(bio, l2);
    await unanswered.idle();
    const failing = gatewayOf([], new FailingEmbedder());
    const unindexed = new IngestQueue({ files, gateway: failing }, log);
    unindexed.enqueue(job);
    await unindexed.idle();

    expect(logs).toEqual([
      { operation: 'tag', courseId: 'bio', lectureKey: 2, outcome: 'TypeError' },
      { operation: 'summarise', courseId: 'bio', lectureKey: 2, outcome: 'TypeError' },
      { operation: 'summarise', courseId: 'bio', lectureKey: 2, outcome: 'TypeError' },
      {
        operation: 'summarise generate',
        courseId: 'bio',
        lectureKey: 2,
        outcome: 'backend-failed',
      },
      { operation: 'ingest', courseId: 'bio', lectureKey: 2, outcome: 'Error' },
    ]);
  });
});
