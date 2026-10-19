import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
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

const completion = (content: string, finishReason = 'stop') =>
  JSON.stringify({
    id: 'chatcmpl-fixture',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
  });

const reply =
  (status: number, body: string): Handler =>
  (_request, _body, response) => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(body);
  };

const Answer = z.object({ text: z.string() });
const request = {
  messages: [
    { role: 'system' as const, content: 'Report what the cited slide says.' },
    { role: 'user' as const, content: 'What does slide 2 say?' },
  ],
  output: { name: 'answer', schema: Answer },
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
      stream: false,
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
    await expect(new OpenAiHttpGenerator(config).chat(request)).resolves.toMatchObject({
      status: 'invalid-output',
      issue: 'cut off at the token limit',
    });
  });

  it.each<[string, Handler]>([
    ['an HTTP error, even with a completion body', reply(500, completion('{"text":"a"}'))],
    ['a body that is not JSON', reply(200, 'not json')],
    ['JSON that is not a chat completion', reply(200, '{"choices":[]}')],
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
