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

/** Each encoder adapter (#66) adds its own settings here. */
export const VerifierConfig = z.strictObject({ pin: VerifierPin });
export const EmbedderConfig = z.strictObject({ pin: EmbedderPin });
export const RerankerConfig = z.strictObject({ pin: RerankerPin });

/** Role config, `docs/adr/0003-model-roles-and-backends.md` § Decision (f); an absent `reranker` means no rerank. */
export const GatewayConfig = z.strictObject({
  generator: HttpGeneratorConfig,
  verifier: VerifierConfig,
  embedder: EmbedderConfig,
  reranker: RerankerConfig.optional(),
});
export type GatewayConfig = z.infer<typeof GatewayConfig>;
