import { z } from 'zod';
import type { ChatWireRequest } from '../../chat';
import type { HttpGeneratorConfig } from '../../role-config';

const ChunkChoice = z.object({
  delta: z.object({ content: z.string().nullish() }),
  finish_reason: z.string().nullish(),
});

const Usage = z.object({ prompt_tokens: z.number(), completion_tokens: z.number() });

/** The fields of a streamed chat-completion chunk this adapter reads; `usage` comes on a last chunk with no choices. */
export const ChatCompletionChunk = z.object({
  choices: z.array(ChunkChoice),
  usage: Usage.nullish(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunk>;

export const chatCompletionsUrl = (endpoint: string): URL =>
  new URL('chat/completions', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);

/** `reasoning_effort` is A12's setting, `docs/adr/0003-model-roles-and-backends.md` § Decision (k). */
export const chatCompletionBody = (config: HttpGeneratorConfig, wire: ChatWireRequest) => ({
  model: config.servedModel,
  messages: wire.messages,
  response_format: {
    type: 'json_schema',
    json_schema: { name: wire.output.name, schema: wire.output.jsonSchema, strict: true },
  },
  temperature: config.sampling.temperature,
  seed: config.sampling.seed,
  reasoning_effort: 'none',
  stream: true,
  stream_options: { include_usage: true },
});
