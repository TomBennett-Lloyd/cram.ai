import { z } from 'zod';
import type { EncoderRole } from './role';

const NonBlank = z.string().regex(/\S/);

/** Shape owned by `docs/adr/0003-model-roles-and-backends.md` § Decision (e). */
const artefactFields = {
  model: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  artefact: z.strictObject({ repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/), file: NonBlank }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  licence: NonBlank,
};

/** The backend per role is § Decision (c)'s table; `node-llama-cpp` joins with its adapter (M5). */
export const GeneratorPin = z.strictObject({
  role: z.literal('generator'),
  backend: z.literal('openai-compatible-http'),
  ...artefactFields,
});
export type GeneratorPin = z.infer<typeof GeneratorPin>;

const encoderPin = <R extends EncoderRole>(role: R) =>
  z.strictObject({ role: z.literal(role), backend: z.literal('onnxruntime'), ...artefactFields });

export const VerifierPin = encoderPin('verifier');
export type VerifierPin = z.infer<typeof VerifierPin>;
export const EmbedderPin = encoderPin('embedder');
export type EmbedderPin = z.infer<typeof EmbedderPin>;
export const RerankerPin = encoderPin('reranker');
export type RerankerPin = z.infer<typeof RerankerPin>;

export const ModelPin = z.discriminatedUnion('role', [
  GeneratorPin,
  VerifierPin,
  EmbedderPin,
  RerankerPin,
]);
export type ModelPin = z.infer<typeof ModelPin>;
