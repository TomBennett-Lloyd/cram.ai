import { describe, expect, it } from 'vitest';
import { ModelPin } from './pin';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';

const generator = PROVISIONAL_DEFAULT_PINS.generator;

describe('ModelPin', () => {
  it('accepts every provisional default', () => {
    for (const pin of Object.values(PROVISIONAL_DEFAULT_PINS)) {
      expect(ModelPin.safeParse(pin).success).toBe(true);
    }
  });

  it('pins the first admitted candidate per role and no reranker', () => {
    expect(
      Object.fromEntries(
        Object.entries(PROVISIONAL_DEFAULT_PINS).map(([role, pin]) => [
          role,
          [pin.model, pin.licence],
        ]),
      ),
    ).toEqual({
      generator: ['Qwen/Qwen3-4B', 'Apache-2.0'],
      verifier: ['cross-encoder/nli-deberta-v3-base', 'Apache-2.0'],
      embedder: ['BAAI/bge-small-en-v1.5', 'MIT'],
    });
  });

  it('refuses a backend the role does not run on', () => {
    expect(ModelPin.safeParse({ ...generator, backend: 'onnxruntime' }).success).toBe(false);
    expect(
      ModelPin.safeParse({
        ...PROVISIONAL_DEFAULT_PINS.embedder,
        backend: 'openai-compatible-http',
      }).success,
    ).toBe(false);
  });

  it('refuses a digest that is not lowercase hex sha256', () => {
    expect(
      ModelPin.safeParse({ ...generator, sha256: generator.sha256.toUpperCase() }).success,
    ).toBe(false);
    expect(ModelPin.safeParse({ ...generator, sha256: generator.sha256.slice(1) }).success).toBe(
      false,
    );
  });

  it('refuses a model or artefact repository that is not an owner/name id', () => {
    expect(ModelPin.safeParse({ ...generator, model: 'Qwen3-4B' }).success).toBe(false);
    expect(
      ModelPin.safeParse({ ...generator, artefact: { ...generator.artefact, repository: 'x' } })
        .success,
    ).toBe(false);
  });

  it('refuses a blank licence and an unknown field', () => {
    expect(ModelPin.safeParse({ ...generator, licence: ' ' }).success).toBe(false);
    expect(ModelPin.safeParse({ ...generator, quant: 'Q4_K_M' }).success).toBe(false);
  });
});
