import { z } from 'zod';
import { ChatWireRequest } from './chat';
import { EmbedRequest, EntailmentResult, EntailRequest, RerankRequest } from './encoder-requests';
import { EmbedderPin, GeneratorPin, RerankerPin, VerifierPin } from './pin';

export const GeneratorReply = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('content'), content: z.string() }),
  z.strictObject({ status: z.literal('backend-failed'), reason: z.string() }),
]);
export type GeneratorReply = z.infer<typeof GeneratorReply>;

const oneReplyPerInput = (replies: number, inputs: number): boolean => replies === inputs;

/** One backend call and its reply; a generator reply is the model's text, before it is parsed. */
export const Recording = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('generator'),
    pin: GeneratorPin,
    request: ChatWireRequest,
    reply: GeneratorReply,
  }),
  z
    .strictObject({
      role: z.literal('embedder'),
      pin: EmbedderPin,
      request: EmbedRequest,
      reply: z.strictObject({ vectors: z.array(z.array(z.number())) }),
    })
    .refine((r) => oneReplyPerInput(r.reply.vectors.length, r.request.texts.length), {
      message: 'one vector per text',
    }),
  z
    .strictObject({
      role: z.literal('reranker'),
      pin: RerankerPin,
      request: RerankRequest,
      reply: z.strictObject({ scores: z.array(z.number()) }),
    })
    .refine((r) => oneReplyPerInput(r.reply.scores.length, r.request.documents.length), {
      message: 'one score per document',
    }),
  z
    .strictObject({
      role: z.literal('verifier'),
      pin: VerifierPin,
      request: EntailRequest,
      reply: z.strictObject({ results: z.array(EntailmentResult) }),
    })
    .refine((r) => oneReplyPerInput(r.reply.results.length, r.request.pairs.length), {
      message: 'one result per pair',
    }),
]);
export type Recording = z.infer<typeof Recording>;
