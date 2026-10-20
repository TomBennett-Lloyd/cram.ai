import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { send, startTestServer, stopTestServer, type TestServer } from './server-fixture';
import { startServer } from './server';
import type { Embedder } from '@cram/gateway';
import { gatewayOf, WordEmbedder } from './server-fixture';

const nonLoopbackAddress = (): string | undefined =>
  Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address;

const connectError = (host: string, port: number): Promise<string | undefined> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code);
    });
  });

let test: TestServer;
beforeEach(async () => {
  test = await startTestServer();
});
afterEach(async () => {
  await stopTestServer(test);
});

const status = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  send(test.server.port, { method, path, headers }).then((received) => received.status);

/** The status line of a request written by hand, so it can omit what `node:http` always sends. */
const rawStatusLine = (port: number, request: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
    socket.on('end', () => {
      resolve(received.split('\r\n')[0] ?? '');
    });
    socket.on('error', reject);
    socket.end(request);
  });

describe('startServer', () => {
  it('listens on the loopback interface only', async () => {
    expect(test.server.boundAddress()).toBe('127.0.0.1');
    const lan = nonLoopbackAddress();
    expect(lan, 'this host has a non-loopback IPv4 address to probe').toBeDefined();
    await expect(connectError(lan ?? '', test.server.port)).resolves.toBe('ECONNREFUSED');
    await expect(connectError('127.0.0.1', test.server.port)).resolves.toBeUndefined();
  });

  it('refuses a request addressed to any host but this server', async () => {
    const { port } = test.server;
    const path = '/courses/bio/ingest';
    expect(await status(path, { host: `127.0.0.1:${String(port)}` })).toBe(404);
    expect(await status(path, { host: `LOCALHOST:${String(port)}` })).toBe(404);
    expect(await status(path, { host: `evil.example:${String(port)}` })).toBe(403);
    expect(await status(path, { host: `127.0.0.1:${String(port + 1)}` })).toBe(403);
    expect(await status(path, { host: '127.0.0.1' })).toBe(403);
    expect(await rawStatusLine(port, `GET ${path} HTTP/1.0\r\n\r\n`)).toBe(
      'HTTP/1.1 403 Forbidden',
    );
  });

  it('refuses a request a browser sent from another origin', async () => {
    const { port } = test.server;
    const path = '/courses/bio/ingest';
    expect(await status(path, { origin: `http://localhost:${String(port)}` })).toBe(404);
    expect(await status(path, { origin: `http://127.0.0.1:${String(port)}` })).toBe(404);
    expect(await status(path, { origin: 'http://evil.example' })).toBe(403);
    expect(await status(path, { origin: `https://127.0.0.1:${String(port)}` })).toBe(403);
    expect(await status(path, { origin: 'null' })).toBe(403);
    expect(await status(path, { origin: `HTTP://LOCALHOST:${String(port)}` })).toBe(403);
  });

  it('answers an unknown path with 404 and a known one with the wrong method with 405', async () => {
    for (const path of [
      '/courses/bio/toString',
      '/courses/bio/ingest/extra',
      '/',
      '/x/courses/bio/ingest',
      '/courses/a/b/ingest',
    ]) {
      const unknown = await send(test.server.port, { method: 'GET', path });
      expect(unknown.status, path).toBe(404);
      expect(unknown.json, path).toEqual({ status: 'not-found' });
    }
    const wrong = await send(test.server.port, { method: 'POST', path: '/courses/bio/ingest' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.allow).toBe('GET');
    expect(wrong.json).toEqual({ status: 'method-not-allowed' });
    expect(await status('/courses/bio/ask', {}, 'GET')).toBe(405);
    expect(await status('/courses/bio/decks', {}, 'GET')).toBe(405);
  });

  it('answers a CORS preflight without granting it', async () => {
    const own = `http://127.0.0.1:${String(test.server.port)}`;
    const preflight = { 'access-control-request-method': 'POST' };
    const path = '/courses/bio/ask';
    expect(await status(path, { ...preflight, origin: 'http://evil.example' }, 'OPTIONS')).toBe(
      403,
    );
    expect(await status(path, { ...preflight, origin: own }, 'OPTIONS')).toBe(405);
  });

  it('answers a request target it cannot parse with 500, and keeps serving', async () => {
    const { port } = test.server;
    const target = `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nConnection: close\r\n\r\n`;
    expect(await rawStatusLine(port, target)).toBe('HTTP/1.1 500 Internal Server Error');
    expect(test.logs).toEqual([{ operation: 'GET ?', courseId: '', outcome: 'TypeError' }]);
    expect(await status('/courses/bio/ingest')).toBe(404);
  });

  it('marks every response uncacheable and unsniffable, and grants no other origin a read', async () => {
    const { headers } = await send(test.server.port, {
      method: 'GET',
      path: '/courses/bio/ingest',
    });
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(Object.keys(headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });

  it('closes with a request still sending its body', async () => {
    const own = await startTestServer();
    const { port } = own.server;
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    const head = [
      'POST /courses/bio/decks?lectureId=l1&fileName=a.pdf HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Content-Type: application/pdf',
      'Content-Length: 1000',
    ];
    socket.write(`${head.join('\r\n')}\r\n\r\n%PDF`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const dropped = new Promise((resolve) => socket.once('close', resolve));
    await stopTestServer(own);
    await dropped;
  });
});

describe('startServer, before it listens', () => {
  it('rejects when its port is taken', async () => {
    await expect(
      startServer({
        gateway: gatewayOf([]),
        dataDir: test.dataDir,
        port: test.server.port,
        log: () => undefined,
      }),
    ).rejects.toThrow('EADDRINUSE');
  });

  it('refuses to start on an embedder that breaks its one-vector-per-text contract', async () => {
    const silent: Embedder = { pin: new WordEmbedder().pin, embed: () => Promise.resolve([]) };
    await expect(
      startServer({
        gateway: gatewayOf([], silent),
        dataDir: '/nonexistent',
        port: 0,
        log: () => undefined,
      }),
    ).rejects.toThrow('returned 0 vectors for 1 texts');
    const extra: Embedder = {
      pin: new WordEmbedder().pin,
      embed: () => Promise.resolve([new Float32Array(8), new Float32Array(8)]),
    };
    await expect(
      startServer({
        gateway: gatewayOf([], extra),
        dataDir: '/nonexistent',
        port: 0,
        log: () => undefined,
      }),
    ).rejects.toThrow('returned 2 vectors for 1 texts');
  });
});
