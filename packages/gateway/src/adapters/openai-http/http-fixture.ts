import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A loopback HTTP server whose `handler` each test sets, for the HTTP adapter's tests. */
export type Handler = (request: IncomingMessage, body: string, response: ServerResponse) => void;

export interface FixtureServer {
  readonly server: Server;
  readonly origin: string;
  handler: Handler;
}

export const startServer = async (): Promise<FixtureServer> => {
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

export const stopServer = async ({ server }: FixtureServer): Promise<void> => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

export const reply =
  (status: number, body: string, contentType = 'text/event-stream'): Handler =>
  (_request, _body, response) => {
    response.writeHead(status, { 'content-type': contentType }).end(body);
  };
