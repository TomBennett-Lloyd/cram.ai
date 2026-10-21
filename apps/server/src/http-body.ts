import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRefusal } from '@cram/shared';

export type BodyRead =
  { readonly status: 'read'; readonly bytes: Uint8Array } | { readonly status: 'too-large' };

/** Drains the whole request either way, so the refusal reaches a client still sending. */
export const readBody = async (request: IncomingMessage, maxBytes: number): Promise<BodyRead> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer))
      throw new Error('readBody: request stream yielded a non-Buffer');
    length += chunk.length;
    if (length <= maxBytes) chunks.push(chunk);
  }
  if (length > maxBytes) return { status: 'too-large' };
  return { status: 'read', bytes: Buffer.concat(chunks) };
};

export const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  response.writeHead(statusCode, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
};

export const sendRefusal = (
  response: ServerResponse,
  statusCode: number,
  refusal: ApiRefusal,
  headers: Readonly<Record<string, string>> = {},
): void => {
  sendJson(response, statusCode, refusal, headers);
};
