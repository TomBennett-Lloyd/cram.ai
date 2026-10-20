import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';
import { manifestDigest, ModelPin } from './pin';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';

const { generator, verifier, embedder } = PROVISIONAL_DEFAULT_PINS;
const OTHER_DIGEST = 'f'.repeat(64);

/** `pin` under `manifest`, its `sha256` recomputed so only the manifest is under test. */
const remanifested = (pin: object, manifest: unknown) => ({
  ...pin,
  manifest,
  sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
});

const withoutFile = (file: string) => ({
  files: Object.fromEntries(
    Object.entries(verifier.manifest.files).filter(([name]) => name !== file),
  ),
});

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
    for (const pin of Object.values(PROVISIONAL_DEFAULT_PINS)) {
      expect(ModelPin.safeParse({ ...pin, quant: 'Q4_K_M' }).success).toBe(false);
    }
  });

  it('refuses a manifest on the generator, whose GGUF carries its own tokenizer', () => {
    expect(ModelPin.safeParse(remanifested(generator, verifier.manifest)).success).toBe(false);
  });
});

describe('an encoder pin’s manifest', () => {
  it('accepts each provisional encoder pin remanifested with its own manifest', () => {
    expect(ModelPin.safeParse(remanifested(verifier, verifier.manifest)).success).toBe(true);
    expect(ModelPin.safeParse(remanifested(embedder, embedder.manifest)).success).toBe(true);
  });

  it.each(Object.keys(verifier.manifest.files))('moves the digest when %s does', (file) => {
    const files = { ...verifier.manifest.files, [file]: OTHER_DIGEST };
    expect(manifestDigest({ files })).not.toBe(verifier.sha256);
  });

  it('moves the embedder digest when its pooling does', () => {
    expect(manifestDigest({ ...embedder.manifest, pooling: 'mean' })).not.toBe(embedder.sha256);
  });

  it('refuses a sha256 that is not the manifest’s digest, on every encoder role', () => {
    expect(ModelPin.safeParse({ ...verifier, sha256: embedder.sha256 }).success).toBe(false);
    expect(ModelPin.safeParse({ ...embedder, sha256: verifier.sha256 }).success).toBe(false);
    const reranker = { ...verifier, role: 'reranker' };
    expect(ModelPin.safeParse({ ...reranker, sha256: embedder.sha256 }).success).toBe(false);
    const files = { ...verifier.manifest.files, 'tokenizer.json': OTHER_DIGEST };
    expect(ModelPin.safeParse({ ...verifier, manifest: { files } }).success).toBe(false);
  });

  it.each(Object.keys(verifier.manifest.files))('refuses a manifest without %s', (file) => {
    expect(ModelPin.safeParse(remanifested(verifier, withoutFile(file))).success).toBe(false);
    const reranker = { ...verifier, role: 'reranker' };
    expect(ModelPin.safeParse(remanifested(reranker, withoutFile(file))).success).toBe(false);
    const manifest = { ...withoutFile(file), pooling: 'cls' };
    expect(ModelPin.safeParse(remanifested(embedder, manifest)).success).toBe(false);
  });

  it('refuses a manifest naming a file the load does not read', () => {
    const files = { ...verifier.manifest.files, 'vocab.txt': OTHER_DIGEST };
    expect(ModelPin.safeParse(remanifested(verifier, { files })).success).toBe(false);
  });

  it('refuses a manifest that does not name artefact.file', () => {
    const artefact = { ...verifier.artefact, file: 'onnx/model_quantized.onnx' };
    expect(ModelPin.safeParse({ ...verifier, artefact }).success).toBe(false);
  });

  it('refuses a file digest that is not lowercase hex sha256', () => {
    const files = { ...verifier.manifest.files, 'config.json': OTHER_DIGEST.toUpperCase() };
    expect(ModelPin.safeParse(remanifested(verifier, { files })).success).toBe(false);
  });

  it.each(['max', undefined])('refuses an embedder pooling of %j', (pooling) => {
    const manifest = { ...embedder.manifest, pooling };
    expect(ModelPin.safeParse(remanifested(embedder, manifest)).success).toBe(false);
  });

  it('refuses a pooling on a classifier role', () => {
    const manifest = { ...verifier.manifest, pooling: 'cls' };
    expect(ModelPin.safeParse(remanifested(verifier, manifest)).success).toBe(false);
    const reranker = { ...verifier, role: 'reranker' };
    expect(ModelPin.safeParse(reranker).success).toBe(true);
    expect(ModelPin.safeParse(remanifested(reranker, manifest)).success).toBe(false);
  });

  it('refuses an unknown manifest field rather than dropping it', () => {
    const manifest = { ...embedder.manifest, revision: 'main' };
    expect(ModelPin.safeParse({ ...embedder, manifest }).success).toBe(false);
  });

  it('refuses a classifier pooling under the digest it would have without one, never dropping it', () => {
    const manifest = { ...verifier.manifest, pooling: 'cls' };
    expect(ModelPin.safeParse({ ...verifier, manifest }).success).toBe(false);
  });
});
