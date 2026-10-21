import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GatewayConfig } from '@cram/gateway';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGateway,
  type Composition,
  type CompositionSpec,
  composeServer,
  type GatewayBuild,
  refusalMessage,
} from './compose-server';
import { developerDefaults, GATEWAY_CONFIG_FILE } from './gateway-config';
import { gatewayOf } from './server-fixture';

let root: string;
let built: GatewayConfig[];

const defaults = (models: string) =>
  developerDefaults({
    platform: 'darwin',
    env: { CRAM_MODELS_DIR: models },
    homedir: '/Users/ann',
  });

const fakeBuild = (config: GatewayConfig): Promise<GatewayBuild> => {
  built.push(config);
  return Promise.resolve({ status: 'built', gateway: gatewayOf([]) });
};

const spec = (env: Record<string, string>, overrides: Partial<CompositionSpec> = {}) => ({
  host: { platform: 'darwin', env, homedir: '/Users/ann' } as const,
  defaults: defaults(join(root, 'models')),
  port: 0,
  log: () => undefined,
  buildGateway: fakeBuild,
  ...overrides,
});

const closed = async (composition: Composition): Promise<Composition> => {
  if (composition.status === 'started') await composition.server.close();
  return composition;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'compose-server-'));
  built = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('composeServer', () => {
  it('starts on loopback with the resolved data directory and the defaults', async () => {
    const composition = await composeServer(spec({ CRAM_DATA_DIR: root }));
    expect(composition).toMatchObject({ status: 'started', dataDir: root, overridden: false });
    if (composition.status === 'started')
      expect(composition.server.boundAddress()).toBe('127.0.0.1');
    await closed(composition);
    expect(built).toEqual([defaults(join(root, 'models'))]);
  });

  it('builds the gateway from the data directory’s overrides', async () => {
    const generator = { ...defaults(join(root, 'models')).generator, servedModel: 'mine' };
    writeFileSync(join(root, GATEWAY_CONFIG_FILE), JSON.stringify({ generator }));
    const composition = await closed(await composeServer(spec({ CRAM_DATA_DIR: root })));
    expect(composition).toMatchObject({ status: 'started', overridden: true });
    expect(built[0]?.generator.servedModel).toBe('mine');
  });

  it('refuses a relative CRAM_DATA_DIR before reading config or building anything', async () => {
    const composition = await composeServer(spec({ CRAM_DATA_DIR: 'data' }));
    expect(composition).toEqual({ status: 'relative-data-dir', value: 'data' });
    expect(built).toEqual([]);
  });

  it('refuses an invalid config file before building the gateway', async () => {
    writeFileSync(join(root, GATEWAY_CONFIG_FILE), '{');
    const composition = await composeServer(spec({ CRAM_DATA_DIR: root }));
    expect(composition).toMatchObject({
      status: 'config-invalid',
      source: join(root, GATEWAY_CONFIG_FILE),
    });
    expect(built).toEqual([]);
  });

  it('refuses when an encoder does not load, starting no server', async () => {
    const composition = await composeServer(spec({ CRAM_DATA_DIR: root }, { buildGateway }));
    expect(composition.status).toBe('load-failed');
  });
});

describe('buildGateway', () => {
  it('names every encoder that did not load, the optional reranker included', async () => {
    const config = defaults(join(root, 'models'));
    const pin = { ...config.verifier.pin, role: 'reranker' as const };
    const build = await buildGateway({ ...config, reranker: { pin, directory: '/absent' } });
    expect(build.status === 'load-failed' && build.failures.map(({ role }) => role)).toEqual([
      'verifier',
      'embedder',
      'reranker',
    ]);
    const without = await buildGateway(config);
    expect(without.status === 'load-failed' && without.failures.map(({ role }) => role)).toEqual([
      'verifier',
      'embedder',
    ]);
  });
});

describe('refusalMessage', () => {
  it('names what to fix in each refusal', () => {
    expect(refusalMessage({ status: 'relative-data-dir', value: 'data' })).toMatch(/'data'/);
    expect(refusalMessage({ status: 'config-invalid', source: '/d/g.json', issues: 'x' })).toMatch(
      /\/d\/g\.json[^]*x/,
    );
    const failure = { status: 'load-failed', role: 'embedder', reason: 'digest-mismatch' } as const;
    expect(
      refusalMessage({ status: 'load-failed', failures: [{ ...failure, detail: '/m/a.onnx' }] }),
    ).toBe('the embedder did not load (digest-mismatch): /m/a.onnx');
  });
});
