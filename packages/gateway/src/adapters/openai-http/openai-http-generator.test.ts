import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest } from '../../chat';
import { type HttpGeneratorConfig, LoopbackEndpoint } from '../../role-config';
import {
  Answer,
  capped,
  chunk,
  completion,
  generatorConfig,
  type Handler,
  reply,
  request,
  SERVED,
  sse,
  stalled,
} from './openai-http-fixture';
import { OpenAiHttpGenerator } from './openai-http-generator';

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

/** Holds this thread, so the client cannot read what the server has sent until `ms` has passed. */
const blockEventLoop = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

let fixture: FixtureServer;
let config: HttpGeneratorConfig;

beforeEach(async () => {
  fixture = await startServer();
  config = generatorConfig(fixture.origin);
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
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
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
      max_tokens: 512,
      reasoning_effort: 'none',
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('reports the sampling it sends, so an eval report records what ran', async () => {
    let sent: unknown;
    fixture.handler = (incoming, body, response) => {
      sent = JSON.parse(body);
      reply(200, completion('{"text":"x"}'))(incoming, body, response);
    };
    const generator = new OpenAiHttpGenerator(config, SERVED);
    await generator.chat(request);
    expect(generator.sampling).toEqual(config.sampling);
    expect(generator.maxOutputTokens).toBe(config.maxOutputTokens);
    expect(sent).toMatchObject(generator.sampling);
  });

  it('resolves the path the same way with no trailing slash on the endpoint', async () => {
    let url: string | undefined;
    fixture.handler = (incoming, body, response) => {
      url = incoming.url;
      reply(200, completion('{"text":"a"}'))(incoming, body, response);
    };
    const endpoint = LoopbackEndpoint.parse(`${fixture.origin}/v1`);
    await new OpenAiHttpGenerator({ ...config, endpoint }, SERVED).chat(request);
    expect(url).toBe('/v1/chat/completions');
  });

  it('reports output that fails the schema as invalid output', async () => {
    fixture.handler = reply(200, completion('{"answer":"a"}'));
    await expect(new OpenAiHttpGenerator(config, SERVED).chat(request)).resolves.toMatchObject({
      status: 'invalid-output',
      content: '{"answer":"a"}',
    });
  });

  it('carries the server error body in the failure reason', async () => {
    fixture.handler = reply(
      404,
      '{"error":{"message":"model \'qwen3-4b-q4km\' not found"}}',
      'application/json',
    );
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'http-status' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(/HTTP 404: .*not found/);
  });

  it('carries the protocol issue in the failure reason', async () => {
    fixture.handler = reply(200, sse([{ choices: 'none' }]));
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'protocol' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(
      /POST .*: not a chat completion chunk: .*choices/s,
    );
  });

  it('names a server that answered with a whole completion instead of a stream', async () => {
    fixture.handler = reply(200, '{"choices":[]}', 'application/json');
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
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
    const generator = new OpenAiHttpGenerator(config, SERVED, () => clock);
    await expect(generator.timedReply(chatWireRequest(request))).resolves.toEqual({
      reply: { status: 'content', content: '{"text":"a"}' },
      timing: { firstTokenMs: 3, lastTokenMs: 3, usage: { promptTokens: 21, completionTokens: 6 } },
    });
  });

  it.each([
    ['', 0],
    [', even when a held event loop delivers both chunks in one read (#243)', 60],
  ])(
    'measures the default clock from the request start to the last token%s',
    async (_name, heldMs) => {
      const server = { handledAt: 0, endedAt: 0 };
      fixture.handler = (_incoming, _body, response) => {
        server.handledAt = performance.now();
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(sse([chunk('{"text":')]).replace('data: [DONE]\n\n', ''));
        setTimeout(() => {
          server.endedAt = performance.now();
          response.end(completion('"a"}'));
        }, 40);
        blockEventLoop(heldMs);
      };
      const before = performance.now();
      const result = await new OpenAiHttpGenerator(config, SERVED).timedReply(
        chatWireRequest(request),
      );
      const callMs = performance.now() - before;
      expect(result.reply).toEqual({ status: 'content', content: '{"text":"a"}' });
      const { firstTokenMs = -1, lastTokenMs = -1 } = result.timing ?? {};
      expect(firstTokenMs).toBeGreaterThanOrEqual(0);
      expect(lastTokenMs).toBeGreaterThanOrEqual(server.endedAt - server.handledAt);
      expect(lastTokenMs).toBeLessThanOrEqual(callMs);
    },
  );

  it('has no timing for a backend failure', async () => {
    fixture.handler = reply(500, completion('{"text":"a"}'));
    const result = await new OpenAiHttpGenerator(config, SERVED).timedReply(
      chatWireRequest(request),
    );
    expect(result).toMatchObject({ reply: { status: 'backend-failed' }, timing: null });
  });

  it('reports a success with no body as a backend failure', async () => {
    fixture.handler = reply(204, '');
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'protocol' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(/no response body/);
  });

  it.each<[string, Handler, string]>([
    [
      'an HTTP error, even with a completion body',
      reply(500, completion('{"text":"a"}')),
      'http-status',
    ],
    ['a body that is not an event stream', reply(200, 'not json'), 'protocol'],
    ['a chunk that is not JSON', reply(200, 'data: not json\n\n'), 'protocol'],
    [
      'a whole JSON completion in place of a stream',
      reply(200, '{"choices":[]}', 'application/json'),
      'protocol',
    ],
  ])('reports %s as a backend failure', async (_name, handler, cause) => {
    fixture.handler = handler;
    await expect(new OpenAiHttpGenerator(config, SERVED).chat(request)).resolves.toMatchObject({
      status: 'backend-failed',
      cause,
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
    await expect(new OpenAiHttpGenerator(config, SERVED).chat(request)).resolves.toMatchObject({
      status: 'backend-failed',
      cause: 'request-error',
    });
  });

  it('reports a closed port as a backend failure', async () => {
    const closed = await startServer();
    await stopServer(closed);
    const endpoint = LoopbackEndpoint.parse(`${closed.origin}/v1/`);
    await expect(
      new OpenAiHttpGenerator({ ...config, endpoint }, SERVED).chat(request),
    ).resolves.toMatchObject({
      status: 'backend-failed',
      cause: 'request-error',
    });
  });
  it('reports output cut off at the token limit as cut off, with its content, even when it parses', async () => {
    fixture.handler = reply(200, completion('{"text":"a"}', 'length'));
    const generator = new OpenAiHttpGenerator(config, SERVED);
    await expect(generator.reply(chatWireRequest(request))).resolves.toEqual({
      status: 'truncated',
      content: '{"text":"a"}',
      cutOffAt: 'token-limit',
    });
    await expect(generator.chat(request)).resolves.toEqual({
      status: 'cut-off',
      content: '{"text":"a"}',
      cutOffAt: 'token-limit',
    });
  });

  it('stops a reply at maxOutputTokens: a stream past the cap is cut off with its content, never a failure', async () => {
    fixture.handler = capped(['{"text":"', 'a', ' b', ' c', ' d', '"}']);
    const capAt3 = new OpenAiHttpGenerator({ ...config, maxOutputTokens: 3 }, SERVED);
    const cut = { status: 'cut-off', content: '{"text":"a b', cutOffAt: 'token-limit' };
    await expect(capAt3.chat(request)).resolves.toEqual(cut);
    const whole = await new OpenAiHttpGenerator(config, SERVED).chat(request);
    expect(whole).toEqual({ status: 'completed', value: { text: 'a b c d' } });
  });

  it('reports a server that does not answer within timeoutMs as a backend failure', async () => {
    fixture.handler = () => undefined;
    const result = await new OpenAiHttpGenerator({ ...config, timeoutMs: 50 }, SERVED).chat(
      request,
    );
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'timeout' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(/TimeoutError/);
  });

  it('bounds the streamed body by timeoutMs too, keeping the N tokens that arrived, cut off', async () => {
    const tokens = ['{"text":', '"a', ' b'];
    fixture.handler = stalled(tokens);
    const generator = new OpenAiHttpGenerator({ ...config, timeoutMs: 50 }, SERVED);
    const timed = await generator.timedReply(chatWireRequest(request));
    expect(timed.reply).toEqual({
      status: 'truncated',
      content: tokens.join(''),
      cutOffAt: 'timeout',
    });
    expect(timed.timing).not.toBeNull();
    await expect(generator.chat(request)).resolves.toEqual({
      status: 'cut-off',
      content: tokens.join(''),
      cutOffAt: 'timeout',
    });
  });

  it('reports a stream that times out before any content as a timeout failure', async () => {
    fixture.handler = stalled(['']);
    const result = await new OpenAiHttpGenerator({ ...config, timeoutMs: 50 }, SERVED).chat(
      request,
    );
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'timeout' });
    expect(result.status === 'backend-failed' && result.reason).toMatch(/TimeoutError/);
  });

  it('drops the content of a stream the server resets, as a request error, not a cut-off', async () => {
    fixture.handler = (incoming, body, response) => {
      stalled(['{"text":"a'])(incoming, body, response);
      setTimeout(() => response.destroy(), 20);
    };
    const result = await new OpenAiHttpGenerator(config, SERVED).chat(request);
    expect(result).toMatchObject({ status: 'backend-failed', cause: 'request-error' });
  });
});
