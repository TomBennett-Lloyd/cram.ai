import { mkdtempSync, rmSync } from 'node:fs';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devServerConfig, forwardedOrigin } from './dev-proxy';
import { LOOPBACK_ADDRESS } from './loopback';
import { send, startTestServer, stopTestServer, type TestServer } from './server-fixture';

const API = 'http://127.0.0.1:4000';

describe('forwardedOrigin', () => {
  it('gives the API its own origin only for a page the dev server served', () => {
    const host = '127.0.0.1:5173';
    expect(forwardedOrigin({ host, origin: 'http://127.0.0.1:5173' }, API)).toBe(API);
    expect(forwardedOrigin({ host: 'localhost:5173', origin: 'http://localhost:5173' }, API)).toBe(
      API,
    );
    expect(forwardedOrigin({ host, origin: 'http://localhost:5173' }, API)).toBe(
      'http://localhost:5173',
    );
    expect(forwardedOrigin({ host, origin: 'http://127.0.0.1:5174' }, API)).toBe(
      'http://127.0.0.1:5174',
    );
    expect(forwardedOrigin({ host, origin: 'https://127.0.0.1:5173' }, API)).toBe(
      'https://127.0.0.1:5173',
    );
    expect(forwardedOrigin({ host, origin: 'null' }, API)).toBe('null');
  });

  it('leaves an absent Origin absent, and an Origin with no Host untouched', () => {
    expect(forwardedOrigin({ host: '127.0.0.1:5173' }, API)).toBeUndefined();
    expect(forwardedOrigin({ origin: 'http://undefined' }, API)).toBe('http://undefined');
  });
});

/** Status and headers only: Vite's own refusals are not JSON. */
const head = (
  port: number,
  method: string,
  headers: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly headers: IncomingHttpHeaders }> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, method, path: '/courses', headers },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });

describe('devServerConfig over apps/web/vite.config.ts, as `pnpm dev` resolves it', () => {
  it('binds loopback, validates Host, serves plain HTTP and sends no CORS headers', async () => {
    const { server } = await resolveConfig(devServerConfig(API), 'serve');
    expect(server.host).toBe(LOOPBACK_ADDRESS);
    expect(server.allowedHosts).not.toBe(true);
    expect(server.https).toBeUndefined();
    expect(server.cors).toBe(false);
  });
});

describe('devServerConfig, between a real dev server and the API', () => {
  let api: TestServer;
  let vite: ViteDevServer;
  let root: string;
  let port: number;
  let devOrigin: string;

  beforeAll(async () => {
    api = await startTestServer();
    root = mkdtempSync(join(tmpdir(), 'dev-proxy-'));
    const config = devServerConfig(api.server.origin, root);
    vite = await createServer({
      ...config,
      configFile: false,
      logLevel: 'silent',
      server: { ...config.server, host: LOOPBACK_ADDRESS, port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address === null || typeof address !== 'object') throw new Error('vite did not listen');
    port = address.port;
    devOrigin = `http://127.0.0.1:${String(port)}`;
  });

  afterAll(async () => {
    await vite.close();
    await stopTestServer(api);
    rmSync(root, { recursive: true, force: true });
  });

  const ask = (origin: string) =>
    send(port, {
      method: 'POST',
      path: '/courses/bio/ask',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What are drones?' }),
    });

  it('forwards a read with no Origin, which the API answers', async () => {
    expect(await send(port, { method: 'GET', path: '/courses' })).toMatchObject({
      status: 200,
      json: { courses: [] },
    });
  });

  it('lets a write from the dev server’s own page past the Origin rule', async () => {
    const reply = await ask(devOrigin);
    expect(reply.status).not.toBe(403);
    expect(reply.json).toMatchObject({ status: 'no-such-course' });
  });

  it('answers no localhost origin with a CORS grant, so a preflight reaches the Origin rule', async () => {
    const origin = 'http://localhost:9999';
    const preflight = await head(port, 'OPTIONS', {
      origin,
      'access-control-request-method': 'POST',
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const read = await head(port, 'GET', { origin });
    expect(read.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a foreign Host before the proxy', async () => {
    expect((await head(port, 'GET', { host: 'rebound.example' })).status).toBe(403);
  });

  it('leaves a cross-site write to the Origin rule, which refuses it', async () => {
    for (const origin of ['http://evil.example', `http://localhost:${String(port)}`])
      expect(await ask(origin)).toMatchObject({ status: 403, json: { status: 'forbidden' } });
  });
});
