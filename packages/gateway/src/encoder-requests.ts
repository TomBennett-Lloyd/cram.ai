import { z } from 'zod';

export const EmbedRequest = z.strictObject({ texts: z.array(z.string()) });
export type EmbedRequest = z.infer<typeof EmbedRequest>;

export const RerankRequest = z.strictObject({ query: z.string(), documents: z.array(z.string()) });
export type RerankRequest = z.infer<typeof RerankRequest>;

export const EntailmentPair = z.strictObject({ premise: z.string(), hypothesis: z.string() });
export type EntailmentPair = z.infer<typeof EntailmentPair>;

export const EntailRequest = z.strictObject({ pairs: z.array(EntailmentPair) });
export type EntailRequest = z.infer<typeof EntailRequest>;

const Probability = z.number().min(0).max(1);
const TokenCount = z.number().int().positive();

/**
 * A pair longer than the verifier's maximum input is reported, never truncated
 * (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)).
 */
export const EntailmentResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('scored'),
    scores: z.strictObject({
      entailment: Probability,
      neutral: Probability,
      contradiction: Probability,
    }),
  }),
  z.strictObject({
    status: z.literal('over-length'),
    inputTokens: TokenCount,
    maxInputTokens: TokenCount,
  }),
]);
export type EntailmentResult = z.infer<typeof EntailmentResult>;
