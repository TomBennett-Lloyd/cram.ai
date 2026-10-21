import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GeneratorPin, PROVISIONAL_DEFAULT_PINS } from '@cram/gateway';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  developerDefaults,
  developerModelsDirectory,
  GATEWAY_CONFIG_FILE,
  readGatewayConfig,
  servedModelName,
} from './gateway-config';

const host = (env: Record<string, string> = {}) =>
  ({ platform: 'darwin', env, homedir: '/Users/ann' }) as const;

const pinWithFile = (file: string): GeneratorPin => ({
  ...PROVISIONAL_DEFAULT_PINS.generator,
  artefact: { repository: 'Org/Model-GGUF', file },
});

// Asserts the naming rule .claude/ledgers/dev-served-model-name.ledger lists.
describe('servedModelName', () => {
  it('is the name `pnpm models:pull` imports the provisional generator under', () => {
    expect(servedModelName(PROVISIONAL_DEFAULT_PINS.generator)).toBe(
      'qwen3-4b-q4_k_m-7485fe6f11af',
    );
  });

  it('drops only a trailing .gguf, as the shell’s ${file%.gguf} does', () => {
    const digest = PROVISIONAL_DEFAULT_PINS.generator.sha256.slice(0, 12);
    expect(servedModelName(pinWithFile('A.gguf-B.gguf'))).toBe(`a.gguf-b-${digest}`);
    expect(servedModelName(pinWithFile('A.GGUF'))).toBe(`a.gguf-${digest}`);
  });
});

describe('developerModelsDirectory', () => {
  it('is CRAM_MODELS_DIR when set and non-empty, else models-pull’s default', () => {
    expect(developerModelsDirectory(host({ CRAM_MODELS_DIR: '/m' }))).toBe('/m');
    expect(developerModelsDirectory(host({ CRAM_MODELS_DIR: '' }))).toBe(
      '/Users/ann/.local/share/cram/models',
    );
    expect(developerModelsDirectory(host())).toBe('/Users/ann/.local/share/cram/models');
  });
});

describe('developerDefaults', () => {
  it('points the generator at Ollama on loopback and each encoder at its snapshot', () => {
    const config = developerDefaults(host({ CRAM_MODELS_DIR: '/m' }));
    expect(config.generator.endpoint).toBe('http://127.0.0.1:11434/v1/');
    expect(config.generator.pin).toBe(PROVISIONAL_DEFAULT_PINS.generator);
    expect(config.generator.sampling).toEqual({ temperature: 0, seed: 0 });
    expect(config.verifier.directory).toBe('/m/cross-encoder/nli-deberta-v3-base');
    expect(config.embedder.directory).toBe('/m/BAAI/bge-small-en-v1.5');
    expect(config.reranker).toBeUndefined();
  });
});

describe('readGatewayConfig', () => {
  let dataDir: string;
  const defaults = developerDefaults(host({ CRAM_MODELS_DIR: '/m' }));
  const writeOverrides = (body: string) => {
    writeFileSync(join(dataDir, GATEWAY_CONFIG_FILE), body);
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'gateway-config-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('is the defaults when the data directory holds no config file', async () => {
    expect(await readGatewayConfig(dataDir, defaults)).toEqual({
      status: 'read',
      config: defaults,
      overridden: false,
    });
  });

  it('replaces each role the file names, whole, and keeps the rest', async () => {
    const generator = { ...defaults.generator, servedModel: 'mine', timeoutMs: 5 };
    writeOverrides(JSON.stringify({ generator }));
    expect(await readGatewayConfig(dataDir, defaults)).toEqual({
      status: 'read',
      config: { ...defaults, generator },
      overridden: true,
    });
  });

  it('refuses a role named only in part, rather than merging into the default', async () => {
    writeOverrides(JSON.stringify({ generator: { servedModel: 'mine' } }));
    const read = await readGatewayConfig(dataDir, defaults);
    expect(read).toMatchObject({ status: 'invalid', source: join(dataDir, GATEWAY_CONFIG_FILE) });
    expect(read.status === 'invalid' && read.issues).toMatch(/generator\.pin/);
  });

  it('refuses a key the schema does not know, and a file that is not JSON', async () => {
    writeOverrides(JSON.stringify({ generatr: defaults.generator }));
    expect(await readGatewayConfig(dataDir, defaults)).toMatchObject({ status: 'invalid' });
    writeOverrides('{');
    const read = await readGatewayConfig(dataDir, defaults);
    expect(read.status === 'invalid' && read.issues).toMatch(/JSON/);
  });

  it('refuses an override the role schema refuses, such as a non-loopback endpoint', async () => {
    writeOverrides(
      JSON.stringify({ generator: { ...defaults.generator, endpoint: 'http://10.0.0.2/v1/' } }),
    );
    expect(await readGatewayConfig(dataDir, defaults)).toMatchObject({ status: 'invalid' });
  });

  it('names the defaults as the source when they fail with no file present, else the file', async () => {
    const relative = developerDefaults(host({ CRAM_MODELS_DIR: 'models' }));
    const read = await readGatewayConfig(dataDir, relative);
    expect(read).toMatchObject({ status: 'invalid', source: 'defaults' });
    expect(read.status === 'invalid' && read.issues).toMatch(/absolute path/);
    writeOverrides(JSON.stringify({ generator: relative.generator }));
    expect(await readGatewayConfig(dataDir, relative)).toMatchObject({
      status: 'invalid',
      source: join(dataDir, GATEWAY_CONFIG_FILE),
    });
  });

  it('throws a read failure other than a missing file', async () => {
    mkdirSync(join(dataDir, GATEWAY_CONFIG_FILE));
    await expect(readGatewayConfig(dataDir, defaults)).rejects.toThrow(/EISDIR/);
  });
});
