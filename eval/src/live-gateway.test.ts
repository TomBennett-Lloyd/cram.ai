import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveConfig } from './live-config';
import { openLiveGateway } from './live-gateway';

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openLiveGateway', () => {
  it('reports the first encoder whose snapshot is missing, and opens nothing', async () => {
    const result = liveConfig({
      CRAM_GENERATOR_ENDPOINT: 'http://127.0.0.1:8080/v1/',
      CRAM_GENERATOR_MODEL: 'served-name',
      CRAM_MODELS_DIR: dir,
    });
    if (result.status !== 'configured') throw new Error(result.message);
    await expect(openLiveGateway(result.config)).resolves.toMatchObject({
      status: 'load-failed',
      role: 'verifier',
      reason: 'unreadable-file',
    });
  });
});
