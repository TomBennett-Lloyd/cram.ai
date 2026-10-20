import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest, OutputName } from '../../chat';
import { PROVISIONAL_DEFAULT_PINS } from '../../provisional-pins';
import type { HttpGeneratorConfig } from '../../role-config';
import { OpenAiHttpGenerator } from './openai-http-generator';

type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

interface FixtureServer {
  readonly server: Server;
  readonly origin: string;
  handler: Handler;
}

const startServer = async (): Promise<FixtureServer> => {
  const fixture: { handler: Handler } = { handler: (_request, _body, response) => response.end() };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      fixture.handler(request, body, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fixture, { server, origin: `http://127.0.0.1:${String(port)}` });
};

const stopServer = async ({ server }: FixtureServer): Promise<void> => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

const sse = (chunks: readonly object[]): string =>
  [...chunks.map((chunk) => JSON.stringify(chunk)), '[DONE]'].map((d) => `data: ${d}\n\n`).join('');

const chunk = (content: string | null, finishReason: string | null = null) => ({
  id: 'chatcmpl-fixture',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
});

const USAGE = { choices: [], usage: { prompt_tokens: 21, completion_tokens: 6 } };

/** A streamed completion: `content` in one delta, then the finish and a usage chunk. */
const completion = (content: string, finishReason = 'stop') =>
  sse([chunk(content), chunk(null, finishReason), USAGE]);

const reply =
  (status: number, body: string, contentType = 'text/event-stream'): Handler =>
  (_request, _body, response) => {
    response.writeHead(status, { 'content-type': contentType }).end(body);
  };

const Answer = z.object({ text: z.string() });
const request = {
  messages: [
    { role: 'system', content: 'Report what the cited slide says.' },
    { role: 'user', content: 'What does slide 2 say?' },
  ] as const,
  output: { name: OutputName.parse('answer'), schema: Answer },
};

let fixture: FixtureServer;
let config: HttpGeneratorConfig;

beforeEach(async () => {
  fixture = await startServer();
  config = {
    pin: PROVISIONAL_DEFAULT_PINS.generator,
    endpoint: `${fixture.origin}/v1/`,
    servedModel: 'qwen3-4b-q4km',
    timeoutMs: 2000,
    sampling: { temperature: 0, seed: 7 },
  };
});

afterEach(async () => {
  await stopServer(fixture);
});

describe('OpenAiHttpGenerator', () => {
  it('posts a JSON-schema chat completion and parses the reply', async () => {
    const seen: { url?: string; method?: string; body?: unknown } = {};
    fixture.handler = (incoming, body, response) => {
      const parsed: unknown = JSON.parse(body);
      Object.assign(seen, { url: incoming.url, method: incoming.method, body: parsed });
      reply(200, completion('{"text":"slide 2 says x"}'))(incoming, body, response);
    };
    const result = await new OpenAiHttpGenerator(config).chat(request);
    expect(result).toEqual({ status: 'completed', value: { text: 'slide 2 says x' } });
    expect(seen).toMatchObject({ url: '/v1/chat/completions', method: 'POST' });
    expect(seen.body).toEqual({
      model: 'qwen3-4b-q4km',
      messages: request.messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer',
          schema: z.toJSONSchema(Answer, { io: 'input' }),
          strict: true,
        },
      },
      temperature: 0,
      seed: 7,
      reasoning_effort: 'none',
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('resolves the path the same way with no trailing slash on the endpoint', async () => {
    let url: string | undefined;
    fixture.handler = (incoming, body, response) => {
      url = incoming.url;
      reply(200, completion('{"text":"a"}'))(incoming, body, response);
    };
    await new OpenAiHttpGenerator({ ...config, endpoint: `${fixture.origin}/v1` }).chat(request);
    expect(url).toBe('/v1/chat/completions');
  });

  it('reports output that fails the schema as invalid output', async () => {
    fixture.handler = reply(200, completion('{"answer":"a"}'));
    await expect(new OpenAiHttpGenerator(config).chat(request)).resolves.toMatchObject({
      status: 'invalid-output',
      content: '{"answer":"a"}',
    });
  });

  it('reports output cut off at the token limit as invalid output, even when it parses', async () => {
    fixture.handler = reply(200, completion('{"text":"a"}', 'length'));
    const generator = new OpenAiHttpGenerator(config);
    await expect(generator.reply(chatWireRequest(request))).resolves.toEqual({
      status: 'truncated',
      content: '{"text":"a"}',
    });
    await expect(generator.chat(request)).resolves.toMatchObject({
      status: 'invalid-output',
      issue: 'cut off at the token limit',
    });
  });

  it('carries the server error body in the failure reason', async () => {
    fixture.handler = reply(
      404,
      '{"error":{"message":"model \'qwen3-4b-q4km\' not found"}}',
      'application/json',
    );
    const result = await new OpenAiHttpGenerator(config).chat(request);
    expect(result.status === 'backend-failed' && result.reason).toMatch(/HTTP 404: .*not found/);
  });

  it('carries the protocol issue in the failure reason', async () => {
    fixture.handler = reply(200, sse([{ choices: 'none' }]));
    const result = await new OpenAiHttpGenerator(config).chat(request);
    expect(result.status === 'backend-failed' && result.reason).toMatch(
      /POST .*: not a chat completion chunk: .*choices/s,
    );
  });

  it('names a server that answered with a whole completion instead of a stream', async () => {
    fixture.handler = reply(200, '{"choices":[]}', 'application/json');
    const result = await new OpenAiHttpGenerator(config).chat(request);
    expect(result.status === 'backend-failed' && result.reason).toMatch(
      /POST .*: the body held no event-stream data line: \{"choices":\[\]\}/,
    );
  });

  it('times the call beside the reply, from the request start, with the server usage', async () => {
    let clock = 1000;
    fixture.handler = (incoming, body, response) => {
      clock = 1003;
      reply(200, completion('{"text":"a"}'))(incoming, body, response);
    };
    const generator = new OpenAiHttpGenerator(config, () => clock);
    await expect(generator.timedReply(chatWireRequest(request))).resolves.toEqual({
      reply: { status: 'content', content: '{"text":"a"}' },
      timing: { firstTokenMs: 3, lastTokenMs: 3, usage: { promptTokens: 21, completionTokens: 6 } },
    });
  });

  it('measures the default clock across the stream', async () => {
    fixture.handler = (_incoming, _body, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(sse([chunk('{"text":')]).replace('data: [DONE]\n\n', ''));
      setTimeout(() => response.end(completion('"a"}')), 40);
    };
    const result = await new OpenAiHttpGenerator(config).timedReply(chatWireRequest(request));
    expect(result.reply).toEqual({ status: 'content', content: '{"text":"a"}' });
    const { firstTokenMs = 0, lastTokenMs = 0 } = result.timing ?? {};
    expect(firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(lastTokenMs - firstTokenMs).toBeGreaterThanOrEqual(20);
  });

  it('has no timing for a backend failure', async () => {
    fixture.handler = reply(500, completion('{"text":"a"}'));
    const result = await new OpenAiHttpGenerator(config).timedReply(chatWireRequest(request));
    expect(result).toMatchObject({ reply: { status: 'backend-failed' }, timing: null });
  });

  it('reports a success with no body as a backend failure', async () => {
    fixture.handler = reply(204, '');
    const result = await new OpenAiHttpGenerator(config).chat(request);
    expect(result.status === 'backend-failed' && result.reason).toMatch(/no response body/);
  });

  it.each<[string, Handler]>([
    ['an HTTP error, even with a completion body', reply(500, completion('{"text":"a"}'))],
    ['a body that is not an event stream', reply(200, 'not json')],
    ['a chunk that is not JSON', reply(200, 'data: not json\n\n')],
    [
      'a whole JSON completion in place of a stream',
      reply(200, '{"choices":[]}', 'application/json'),
    ],
  ])('reports %s as a backend failure', async (_name, handler) => {
    fixture.handler = handler;
    await expect(new OpenAiHttpGenerator(config).chat(request)).resolves.toMatchObject({
      status: 'backend-failed',
    });
  });

  it('refuses a redirect rather than following it', async () => {
    fixture.handler = (incoming, body, response) => {
      if (incoming.url === '/elsewhere') {
        reply(200, completion('{"text":"a"}'))(incoming, body, response);
        return;
      }
      response.writeHead(307, { location: `${fixture.origin}/elsewhere` }).end();
    };
    await expect(new OpenAiHttpGenerator(config).chat(request)).resolves.toMatchObject({
      status: 'backend-failed',
    });
  });

  it('reports a server that does not answer within timeoutMs as a backend failure', async () => {
    fixture.handler = () => undefined;
    const result = await new OpenAiHttpGenerator({ ...config, timeoutMs: 50 }).chat(request);
    expect(result).toMatchObject({ status: 'backend-failed' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(/TimeoutError/);
  });

  it('bounds the streamed body by timeoutMs too', async () => {
    fixture.handler = (_incoming, _body, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify(chunk('{"text":'))}\n\n`);
    };
    const result = await new OpenAiHttpGenerator({ ...config, timeoutMs: 50 }).chat(request);
    expect(result.status === 'backend-failed' && result.reason).toMatch(/TimeoutError/);
  });

  it('reports a closed port as a backend failure', async () => {
    const closed = await startServer();
    await stopServer(closed);
    const endpoint = `${closed.origin}/v1/`;
    await expect(
      new OpenAiHttpGenerator({ ...config, endpoint }).chat(request),
    ).resolves.toMatchObject({
      status: 'backend-failed',
    });
  });

  it('throws at construction on an endpoint off loopback', () => {
    expect(
      () => new OpenAiHttpGenerator({ ...config, endpoint: 'http://192.168.1.10:11434/v1/' }),
    ).toThrow();
  });
});
