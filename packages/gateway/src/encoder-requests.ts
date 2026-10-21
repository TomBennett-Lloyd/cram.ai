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
 * An input longer than the model's maximum is reported, never truncated
 * (`docs/adr/0003-model-roles-and-backends.md` § Decision (d); #66 for the embedder and reranker).
 */
export const OverLength = z.strictObject({
  status: z.literal('over-length'),
  inputTokens: TokenCount,
  maxInputTokens: TokenCount,
});
export type OverLength = z.infer<typeof OverLength>;

export const EntailmentResult = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('scored'),
    scores: z.strictObject({
      entailment: Probability,
      neutral: Probability,
      contradiction: Probability,
    }),
  }),
  OverLength,
]);
export type EntailmentResult = z.infer<typeof EntailmentResult>;

export const EmbeddingResult = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('embedded'), vector: z.instanceof(Float32Array) }),
  OverLength,
]);
export type EmbeddingResult = z.infer<typeof EmbeddingResult>;

export const RecordedEmbedding = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('embedded'), vector: z.array(z.number()) }),
  OverLength,
]);
export type RecordedEmbedding = z.infer<typeof RecordedEmbedding>;

export const RerankResult = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('scored'), score: z.number() }),
  OverLength,
]);
export type RerankResult = z.infer<typeof RerankResult>;
