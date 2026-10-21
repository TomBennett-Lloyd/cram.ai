import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiProxy, forwardedOrigin } from './dev-proxy';
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

describe('apiProxy, between a real dev server and the API', () => {
  let api: TestServer;
  let vite: ViteDevServer;
  let root: string;
  let port: number;
  let devOrigin: string;

  beforeAll(async () => {
    api = await startTestServer();
    root = mkdtempSync(join(tmpdir(), 'dev-proxy-'));
    vite = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, proxy: apiProxy(api.server.origin) },
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

  it('leaves a cross-site write to the Origin rule, which refuses it', async () => {
    for (const origin of ['http://evil.example', `http://localhost:${String(port)}`])
      expect(await ask(origin)).toMatchObject({ status: 403, json: { status: 'forbidden' } });
  });
});
