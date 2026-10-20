import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import { ChatWireRequest, GeneratorReply } from './chat';
import {
  EmbedRequest,
  EntailmentResult,
  EntailRequest,
  RecordedEmbedding,
  RerankRequest,
  RerankResult,
} from './encoder-requests';
import { EmbedderPin, GeneratorPin, type ModelPin, RerankerPin, VerifierPin } from './pin';
import { Sampling } from './role-config';

const oneReplyPerInput = (replies: number, inputs: number): boolean => replies === inputs;

/** One backend call and its reply, keyed by pin, request and, for the generator, sampling. */
export const Recording = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('generator'),
    pin: GeneratorPin,
    sampling: Sampling,
    request: ChatWireRequest,
    reply: GeneratorReply,
  }),
  z
    .strictObject({
      role: z.literal('embedder'),
      pin: EmbedderPin,
      request: EmbedRequest,
      reply: z.strictObject({ results: z.array(RecordedEmbedding) }),
    })
    .refine((r) => oneReplyPerInput(r.reply.results.length, r.request.texts.length), {
      message: 'one result per text',
    }),
  z
    .strictObject({
      role: z.literal('reranker'),
      pin: RerankerPin,
      request: RerankRequest,
      reply: z.strictObject({ results: z.array(RerankResult) }),
    })
    .refine((r) => oneReplyPerInput(r.reply.results.length, r.request.documents.length), {
      message: 'one result per document',
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

/** A call as its recording identifies it; the pin names the role. */
export interface RecordedCall {
  readonly pin: ModelPin;
  readonly request: unknown;
  readonly sampling?: Sampling;
}

/** The one key a recording is stored and replayed by: everything but the reply, in key-order-free JSON. */
export const recordingKey = ({ pin, request, sampling }: RecordedCall): string =>
  canonicalJson({ pin, request, sampling });
