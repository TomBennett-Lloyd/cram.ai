import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ModelGateway } from '@cram/gateway';
import { askQuestion, type HandlerContext, ingestStatus, uploadDeck } from './handlers';
import { sendJson } from './http-body';
import { IngestQueue } from './ingest-queue';
import { isOwnOriginRequest, LOOPBACK_ADDRESS } from './loopback';
import { matchRoute } from './routes';
import { errorName, type ServerLog } from './server-log';
import { embedderIdentity } from './slide-embedding';

/** What a run mode supplies; no host, since the bind address is not a setting (`docs/adr/0002-deployables.md` § Decision (d)). */
export interface ServerSpec {
  readonly gateway: ModelGateway;
  readonly dataDir: string;
  /** `0` lets the OS choose. */
  readonly port: number;
  readonly log: ServerLog;
}

/** The request boundary (`docs/standards/error-handling.md` rule 2): an unexpected throw is a 500, logged. */
const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  context: HandlerContext,
): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://${LOOPBACK_ADDRESS}`);
  try {
    if (!isOwnOriginRequest(request.headers, request.socket.localPort ?? 0)) {
      sendJson(response, 403, { status: 'forbidden' });
      return;
    }
    const match = matchRoute(request.method, url.pathname);
    if (match.status === 'not-found') {
      sendJson(response, 404, { status: 'not-found' });
      return;
    }
    if (match.status === 'method-not-allowed') {
      sendJson(response, 405, { status: 'method-not-allowed' }, { allow: match.allow });
      return;
    }
    const route = { request, response, url, courseSegment: match.courseSegment };
    switch (match.route) {
      case 'upload-deck':
        await uploadDeck(route, context);
        return;
      case 'ingest-status':
        ingestStatus(route, context);
        return;
      case 'ask':
        await askQuestion(route, context);
    }
  } catch (error) {
    context.log({
      operation: `${request.method ?? '?'} ${url.pathname}`,
      courseId: '',
      outcome: errorName(error),
    });
    if (!response.headersSent) sendJson(response, 500, { status: 'internal-error' });
  }
};

const listen = (server: Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK_ADDRESS, () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string')
        reject(new Error('startServer: listening on a pipe, not a TCP port'));
      else resolve(address.port);
    });
  });

export class CramServer {
  readonly port: number;
  readonly origin: string;
  readonly #server: Server;
  readonly #queue: IngestQueue;

  constructor(server: Server, queue: IngestQueue, port: number) {
    this.#server = server;
    this.#queue = queue;
    this.port = port;
    this.origin = `http://${LOOPBACK_ADDRESS}:${String(port)}`;
  }

  /** The address the socket is bound to, as the OS reports it. */
  boundAddress(): string | undefined {
    const address = this.#server.address();
    return address === null || typeof address === 'string' ? undefined : address.address;
  }

  /** Stops accepting requests, then waits for queued uploads to finish writing. */
  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
      this.#server.closeAllConnections();
    });
    await this.#queue.idle();
  }
}

export const startServer = async (spec: ServerSpec): Promise<CramServer> => {
  const { gateway, dataDir, log } = spec;
  const files = { dataDir, embedder: await embedderIdentity(gateway.embedder) };
  const queue = new IngestQueue({ files, embedder: gateway.embedder }, log);
  const context: HandlerContext = { files, gateway, log, queue };
  const server = createServer((request, response) => {
    void handleRequest(request, response, context);
  });
  return new CramServer(server, queue, await listen(server, spec.port));
};
