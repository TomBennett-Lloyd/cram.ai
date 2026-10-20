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
  });

  it('refuses a request a browser sent from another origin', async () => {
    const { port } = test.server;
    const path = '/courses/bio/ingest';
    expect(await status(path, { origin: `http://localhost:${String(port)}` })).toBe(404);
    expect(await status(path, { origin: `http://127.0.0.1:${String(port)}` })).toBe(404);
    expect(await status(path, { origin: 'http://evil.example' })).toBe(403);
    expect(await status(path, { origin: `https://127.0.0.1:${String(port)}` })).toBe(403);
    expect(await status(path, { origin: 'null' })).toBe(403);
  });

  it('answers an unknown path with 404 and a known one with the wrong method with 405', async () => {
    expect(await status('/courses/bio/toString')).toBe(404);
    expect(await status('/courses/bio/ingest/extra')).toBe(404);
    expect(await status('/')).toBe(404);
    const wrong = await send(test.server.port, { method: 'POST', path: '/courses/bio/ingest' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.allow).toBe('GET');
    expect(wrong.json).toEqual({ status: 'method-not-allowed' });
    expect(await status('/courses/bio/ask', {}, 'GET')).toBe(405);
    expect(await status('/courses/bio/decks', {}, 'GET')).toBe(405);
  });
});

describe('startServer, before it listens', () => {
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
  });
});
