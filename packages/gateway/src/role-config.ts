import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { EmbedderPin, GeneratorPin, RerankerPin, VerifierPin } from './pin';

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

/** Loopback only: a private-network generator host is placed, not adopted (`docs/adr/0003-model-roles-and-backends.md` § Decision (j)). */
export const LoopbackEndpoint = z.url({ protocol: /^https?$/, hostname: LOOPBACK_HOST });

export const Sampling = z.strictObject({ temperature: z.number().min(0), seed: z.number().int() });
export type Sampling = z.infer<typeof Sampling>;

export const HttpGeneratorConfig = z.strictObject({
  pin: GeneratorPin,
  endpoint: LoopbackEndpoint,
  servedModel: z.string().regex(/\S/),
  timeoutMs: z.number().int().positive(),
  sampling: Sampling,
});
export type HttpGeneratorConfig = z.infer<typeof HttpGeneratorConfig>;

/** A local snapshot of the pin's `artefact.repository`; weights are never fetched (`docs/adr/0003-model-roles-and-backends.md` § Decision (i)). */
export const ArtefactDirectory = z.string().refine(isAbsolute, 'an absolute path');

export const VerifierConfig = z.strictObject({ pin: VerifierPin, directory: ArtefactDirectory });
export type VerifierConfig = z.infer<typeof VerifierConfig>;

export const EmbedderConfig = z.strictObject({ pin: EmbedderPin, directory: ArtefactDirectory });
export type EmbedderConfig = z.infer<typeof EmbedderConfig>;

export const RerankerConfig = z.strictObject({ pin: RerankerPin, directory: ArtefactDirectory });
export type RerankerConfig = z.infer<typeof RerankerConfig>;

/** Role config, `docs/adr/0003-model-roles-and-backends.md` § Decision (f); an absent `reranker` means no rerank. */
export const GatewayConfig = z.strictObject({
  generator: HttpGeneratorConfig,
  verifier: VerifierConfig,
  embedder: EmbedderConfig,
  reranker: RerankerConfig.optional(),
});
export type GatewayConfig = z.infer<typeof GatewayConfig>;
