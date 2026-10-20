import { describe, expect, it } from 'vitest';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';
import { GatewayConfig } from './role-config';

const config = {
  generator: {
    pin: PROVISIONAL_DEFAULT_PINS.generator,
    endpoint: 'http://127.0.0.1:11434/v1/',
    servedModel: 'qwen3-4b-q4km',
    timeoutMs: 1000,
    sampling: { temperature: 0, seed: 0 },
  },
  verifier: { pin: PROVISIONAL_DEFAULT_PINS.verifier },
  embedder: { pin: PROVISIONAL_DEFAULT_PINS.embedder },
};

const withEndpoint = (endpoint: string) => ({
  ...config,
  generator: { ...config.generator, endpoint },
});

describe('GatewayConfig', () => {
  it('accepts the three required roles with no reranker', () => {
    expect(GatewayConfig.safeParse(config).success).toBe(true);
  });

  it('accepts a reranker pinned to the reranker role only', () => {
    const reranker = { ...PROVISIONAL_DEFAULT_PINS.embedder, role: 'reranker' };
    expect(GatewayConfig.safeParse({ ...config, reranker: { pin: reranker } }).success).toBe(true);
    expect(
      GatewayConfig.safeParse({ ...config, reranker: { pin: PROVISIONAL_DEFAULT_PINS.embedder } })
        .success,
    ).toBe(false);
  });

  it('refuses a pin configured under another role', () => {
    expect(
      GatewayConfig.safeParse({ ...config, verifier: { pin: PROVISIONAL_DEFAULT_PINS.embedder } })
        .success,
    ).toBe(false);
  });

  it.each(['http://localhost:11434/v1/', 'http://127.0.0.2:8080/v1', 'https://[::1]:11434/v1/'])(
    'accepts the loopback endpoint %s',
    (endpoint) => {
      expect(GatewayConfig.safeParse(withEndpoint(endpoint)).success).toBe(true);
    },
  );

  it.each([
    'http://192.168.1.10:11434/v1/',
    'http://10.0.0.1/v1/',
    'http://example.com/v1/',
    'http://localhost.example.com/v1/',
    'http://127.0.0.1.example.com/v1/',
    'ftp://127.0.0.1/v1/',
    'http://0.0.0.0:11434/v1/',
  ])('refuses the non-loopback endpoint %s', (endpoint) => {
    expect(GatewayConfig.safeParse(withEndpoint(endpoint)).success).toBe(false);
  });

  it('refuses an unknown key rather than dropping it', () => {
    expect(
      GatewayConfig.safeParse({ ...config, embedder: { ...config.embedder, path: '/m' } }).success,
    ).toBe(false);
  });
});
