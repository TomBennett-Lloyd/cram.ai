import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import type { EncoderRole } from './role';

const NonBlank = z.string().regex(/\S/);
const RepositoryId = z.string().regex(/^[^/\s]+\/[^/\s]+$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** Shape owned by `docs/adr/0003-model-roles-and-backends.md` § Decision (e). */
const artefactFields = {
  model: RepositoryId,
  artefact: z.strictObject({ repository: RepositoryId, file: NonBlank }),
  sha256: Sha256,
  licence: NonBlank,
};

/** The backend per role is § Decision (c)'s table; `node-llama-cpp` joins with its adapter (M5). */
export const GeneratorPin = z.strictObject({
  role: z.literal('generator'),
  backend: z.literal('openai-compatible-http'),
  ...artefactFields,
});
export type GeneratorPin = z.infer<typeof GeneratorPin>;

/** Read beside `artefact.file` from the snapshot's root, as a Hugging Face repository lays them out. */
export const TOKENIZER_FILE = 'tokenizer.json';
export const TOKENIZER_CONFIG_FILE = 'tokenizer_config.json';
export const MODEL_CONFIG_FILE = 'config.json';
const SIDECAR_FILES = [TOKENIZER_FILE, TOKENIZER_CONFIG_FILE, MODEL_CONFIG_FILE];

/** How token states become one vector; a property of the pinned model, not a tuning knob. */
export const Pooling = z.enum(['cls', 'mean']);
export type Pooling = z.infer<typeof Pooling>;

/** The sha256 of each snapshot file an encoder pin fixes, by its path in the snapshot. */
const ManifestFiles = z.record(NonBlank, Sha256);
const ClassifierManifest = z.strictObject({ files: ManifestFiles });
const EmbedderManifest = z.strictObject({ files: ManifestFiles, pooling: Pooling });
export type EncoderManifest = z.infer<typeof ClassifierManifest | typeof EmbedderManifest>;

/** An encoder pin's `sha256`: the digest of its manifest's canonical JSON. */
export const manifestDigest = (manifest: EncoderManifest): string =>
  createHash('sha256').update(canonicalJson(manifest)).digest('hex');

interface ManifestedPin {
  readonly artefact: { readonly file: string };
  readonly manifest: EncoderManifest;
  readonly sha256: string;
}

/** Without the digest check, two manifests could carry one identity (#124). */
const manifestHolds = (pin: ManifestedPin, context: z.RefinementCtx): void => {
  const required = new Set([pin.artefact.file, ...SIDECAR_FILES]);
  const named = Object.keys(pin.manifest.files);
  if (named.length !== required.size || !named.every((file) => required.has(file))) {
    context.addIssue({
      code: 'custom',
      path: ['manifest', 'files'],
      message: `names ${named.join(', ')}; an encoder pin fixes ${[...required].join(', ')}`,
    });
  }
  if (pin.sha256 !== manifestDigest(pin.manifest)) {
    context.addIssue({ code: 'custom', path: ['sha256'], message: 'is not the manifest’s digest' });
  }
};

const encoderFields = <R extends EncoderRole>(role: R) => ({
  role: z.literal(role),
  backend: z.literal('onnxruntime'),
  ...artefactFields,
});

export const VerifierPin = z
  .strictObject({ ...encoderFields('verifier'), manifest: ClassifierManifest })
  .superRefine(manifestHolds);
export type VerifierPin = z.infer<typeof VerifierPin>;
export const EmbedderPin = z
  .strictObject({ ...encoderFields('embedder'), manifest: EmbedderManifest })
  .superRefine(manifestHolds);
export type EmbedderPin = z.infer<typeof EmbedderPin>;
export const RerankerPin = z
  .strictObject({ ...encoderFields('reranker'), manifest: ClassifierManifest })
  .superRefine(manifestHolds);
export type RerankerPin = z.infer<typeof RerankerPin>;
export type EncoderPin = VerifierPin | EmbedderPin | RerankerPin;

export const ModelPin = z.discriminatedUnion('role', [
  GeneratorPin,
  VerifierPin,
  EmbedderPin,
  RerankerPin,
]);
export type ModelPin = z.infer<typeof ModelPin>;
