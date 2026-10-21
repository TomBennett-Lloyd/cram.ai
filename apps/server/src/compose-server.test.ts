import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EncoderLoad,
  EncoderLoadFailure,
  EncoderRole,
  GatewayConfig,
  GeneratorLoadFailure,
  Reranker,
} from '@cram/gateway';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGateway,
  type Composition,
  type CompositionSpec,
  composeServer,
  type GatewayBuild,
  refusalMessage,
  ROLE_LOADERS,
  type RoleLoaders,
} from './compose-server';
import { developerDefaults, GATEWAY_CONFIG_FILE } from './gateway-config';
import { gatewayOf, WordEmbedder } from './server-fixture';

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

  it('refuses when the served weights or an encoder do not load, starting no server', async () => {
    const show = createServer((_request, response) => {
      const modelfile = `FROM /m/blobs/sha256-${'a'.repeat(64)}`;
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ modelfile }));
    });
    await new Promise<void>((resolve) => show.listen(0, '127.0.0.1', resolve));
    const { port } = show.address() as AddressInfo;
    const generator = {
      ...defaults(join(root, 'models')).generator,
      endpoint: `http://127.0.0.1:${String(port)}/v1/`,
    };
    writeFileSync(join(root, GATEWAY_CONFIG_FILE), JSON.stringify({ generator }));
    const composition = await composeServer(spec({ CRAM_DATA_DIR: root }, { buildGateway }));
    await new Promise((resolve) => show.close(resolve));
    expect(
      composition.status === 'load-failed' && composition.failures.map(({ role }) => role),
    ).toEqual(['generator', 'verifier', 'embedder']);
  });
});

const failed = (role: EncoderRole): EncoderLoadFailure => ({
  status: 'load-failed',
  role,
  reason: 'unreadable-file',
  detail: role,
});
const mismatched: GeneratorLoadFailure = {
  status: 'load-failed',
  role: 'generator',
  reason: 'served-mismatch',
  detail: 'serves blob sha256-a',
};
const loaded = <T>(encoder: T): Promise<EncoderLoad<T>> =>
  Promise.resolve({ status: 'loaded', encoder });

describe('buildGateway', () => {
  const config = () => defaults(join(root, 'models'));
  const withReranker = (): GatewayConfig => {
    const base = config();
    const pin = { ...base.verifier.pin, role: 'reranker' as const };
    return { ...base, reranker: { pin, directory: '/absent' } };
  };
  const fake = gatewayOf([]);
  const reranker: Reranker = {
    pin: { ...fake.verifier.pin, role: 'reranker' },
    rerank: () => Promise.resolve([]),
  };
  const generator = fake.generator;
  const loaders: RoleLoaders = {
    generator: () => Promise.resolve({ status: 'loaded', generator }),
    verifier: () => loaded(fake.verifier),
    embedder: () => loaded(new WordEmbedder()),
    reranker: () => loaded(reranker),
  };

  it('assembles the gateway when every encoder loads, the reranker only when configured', async () => {
    const without = await buildGateway(config(), loaders);
    expect(without.status === 'built' && without.gateway.reranker).toBeNull();
    const built = await buildGateway(withReranker(), loaders);
    expect(built.status === 'built' && built.gateway.reranker).toBe(reranker);
    expect(built.status === 'built' && built.gateway.verifier).toBe(fake.verifier);
    expect(built.status === 'built' && built.gateway.generator).toBe(generator);
  });

  it('names only the roles that failed, whichever they are', async () => {
    const roles = async (overrides: Partial<RoleLoaders>, gateway = withReranker()) => {
      const build = await buildGateway(gateway, { ...loaders, ...overrides });
      return build.status === 'load-failed' ? build.failures.map(({ role }) => role) : build.status;
    };
    expect(await roles({ generator: () => Promise.resolve(mismatched) })).toEqual(['generator']);
    expect(await roles({ embedder: () => Promise.resolve(failed('embedder')) })).toEqual([
      'embedder',
    ]);
    expect(await roles({ verifier: () => Promise.resolve(failed('verifier')) })).toEqual([
      'verifier',
    ]);
    expect(await roles({ reranker: () => Promise.resolve(failed('reranker')) })).toEqual([
      'reranker',
    ]);
    expect(await roles({ reranker: () => Promise.resolve(failed('reranker')) }, config())).toEqual(
      'built',
    );
  });

  it('names every ONNX snapshot that did not load, the optional reranker included', async () => {
    const onnx = { ...ROLE_LOADERS, generator: loaders.generator };
    const build = await buildGateway(withReranker(), onnx);
    expect(build.status === 'load-failed' && build.failures.map(({ role }) => role)).toEqual([
      'verifier',
      'embedder',
      'reranker',
    ]);
    const without = await buildGateway(config(), onnx);
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
    expect(refusalMessage({ status: 'load-failed', failures: [mismatched] })).toBe(
      'the generator did not load (served-mismatch): serves blob sha256-a',
    );
  });
});
