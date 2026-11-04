import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { OutputName } from '../../chat';
import { PROVISIONAL_DEFAULT_PINS } from '../../provisional-pins';
import { type HttpGeneratorConfig, LoopbackEndpoint } from '../../role-config';

export const SERVED = { status: 'verified' } as const;

export type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

export const reply =
  (status: number, body: string, contentType = 'text/event-stream'): Handler =>
  (_request, _body, response) => {
    response.writeHead(status, { 'content-type': contentType }).end(body);
  };

export const sse = (chunks: readonly object[]): string =>
  [...chunks.map((chunk) => JSON.stringify(chunk)), '[DONE]'].map((d) => `data: ${d}\n\n`).join('');

export const chunk = (content: string | null, finishReason: string | null = null) => ({
  id: 'chatcmpl-fixture',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
});

export const USAGE = { choices: [], usage: { prompt_tokens: 21, completion_tokens: 6 } };

export const completion = (content: string, finishReason = 'stop') =>
  sse([chunk(content), chunk(null, finishReason), USAGE]);

/** Streams `tokens` one per chunk until the request's `max_tokens`, as a capped server does, then finishes `length`. */
export const capped =
  (tokens: readonly string[]): Handler =>
  (_request, body, response) => {
    const { max_tokens: cap } = z.object({ max_tokens: z.number() }).parse(JSON.parse(body));
    const sent = tokens.slice(0, cap);
    const finish = sent.length < tokens.length ? 'length' : 'stop';
    response
      .writeHead(200, { 'content-type': 'text/event-stream' })
      .end(sse([...sent.map((token) => chunk(token)), chunk(null, finish), USAGE]));
  };

/** Sends `tokens` one per chunk, then holds the stream open with no finish. */
export const stalled =
  (tokens: readonly string[]): Handler =>
  (_request, _body, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const token of tokens) response.write(`data: ${JSON.stringify(chunk(token))}\n\n`);
  };

export const Answer = z.object({ text: z.string() });
export const request = {
  messages: [
    { role: 'system', content: 'Report what the cited slide says.' },
    { role: 'user', content: 'What does slide 2 say?' },
  ] as const,
  output: { name: OutputName.parse('answer'), schema: Answer },
};

export const generatorConfig = (origin: string): HttpGeneratorConfig => ({
  pin: PROVISIONAL_DEFAULT_PINS.generator,
  endpoint: LoopbackEndpoint.parse(`${origin}/v1/`),
  servedModel: 'qwen3-4b-q4km',
  timeoutMs: 2000,
  maxOutputTokens: 512,
  sampling: { temperature: 0, seed: 7 },
});
