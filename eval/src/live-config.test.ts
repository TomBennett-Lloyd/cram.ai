import { describe, expect, it } from 'vitest';
import { LIVE_PINS, LIVE_SAMPLING, liveConfig } from './live-config';

const ENV = {
  CRAM_GENERATOR_ENDPOINT: 'http://127.0.0.1:8080/v1/',
  CRAM_GENERATOR_MODEL: 'served-name',
  CRAM_MODELS_DIR: '/models',
};

const configured = (env: Record<string, string | undefined>) => {
  const result = liveConfig(env);
  if (result.status !== 'configured') throw new Error(result.message);
  return result.config;
};

describe('liveConfig', () => {
  it('configures each role from its pin, the generator as models:pull prints it', () => {
    const config = configured(ENV);
    expect(config.generator).toMatchObject({
      pin: LIVE_PINS.generator,
      endpoint: ENV.CRAM_GENERATOR_ENDPOINT,
      servedModel: ENV.CRAM_GENERATOR_MODEL,
      sampling: LIVE_SAMPLING,
    });
    expect(config.verifier).toEqual({
      pin: LIVE_PINS.verifier,
      directory: '/models/cross-encoder/nli-deberta-v3-base',
    });
    expect(config.embedder).toMatchObject({
      pin: LIVE_PINS.embedder,
      directory: '/models/BAAI/bge-small-en-v1.5',
    });
    expect(config.reranker).toBeUndefined();
  });

  it('samples at temperature 0 with a fixed seed', () => {
    expect(LIVE_SAMPLING).toEqual({ temperature: 0, seed: 0 });
  });

  it.each(['CRAM_GENERATOR_ENDPOINT', 'CRAM_GENERATOR_MODEL', 'CRAM_MODELS_DIR'])(
    'is unconfigured without %s, and names it',
    (name) => {
      const result = liveConfig({ ...ENV, [name]: undefined });
      expect(result).toMatchObject({ status: 'unconfigured' });
      expect(result.status === 'unconfigured' && result.message).toContain(name);
    },
  );

  it('refuses a generator endpoint off loopback', () => {
    expect(
      liveConfig({ ...ENV, CRAM_GENERATOR_ENDPOINT: 'http://10.0.0.2:8080/v1/' }),
    ).toMatchObject({ status: 'unconfigured' });
  });

  it('refuses a relative models directory', () => {
    expect(liveConfig({ ...ENV, CRAM_MODELS_DIR: 'models' })).toMatchObject({
      status: 'unconfigured',
    });
  });
});
