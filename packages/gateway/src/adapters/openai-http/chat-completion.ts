import { z } from 'zod';
import type { ChatWireRequest } from '../../chat';
import type { HttpGeneratorConfig } from '../../role-config';

const Choice = z.object({
  message: z.object({ content: z.string() }),
  finish_reason: z.string().nullable(),
});

/** The fields of an OpenAI chat completion this adapter reads; the rest is ignored. */
export const ChatCompletion = z.object({ choices: z.tuple([Choice], Choice) });

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
  stream: false,
});
