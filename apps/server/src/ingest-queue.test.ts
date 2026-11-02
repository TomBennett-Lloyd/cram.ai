import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseId, LectureId } from '@cram/shared';
import type { ChatRequest, ChatResult } from '@cram/gateway';
import { afterEach, describe, expect, it } from 'vitest';
import { IngestQueue } from './ingest-queue';
import type { LogEntry } from './server-log';
import { seededDataDir } from './repair-fixture';
import { gatewayOf, WordEmbedder } from './server-fixture';
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
