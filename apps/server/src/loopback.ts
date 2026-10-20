import type { IncomingHttpHeaders } from 'node:http';

/** The only address the server listens on (`docs/adr/0002-deployables.md` § Decision (d)). */
export const LOOPBACK_ADDRESS = '127.0.0.1';

const HOST_NAMES = [LOOPBACK_ADDRESS, 'localhost'];

/** Refuses DNS rebinding (`Host`) and cross-site writes (`Origin`); no CORS header is ever sent. */
export const isOwnOriginRequest = (headers: IncomingHttpHeaders, port: number): boolean => {
  const hosts = HOST_NAMES.map((name) => `${name}:${String(port)}`);
  const host = headers.host?.toLowerCase();
  if (host === undefined || !hosts.includes(host)) return false;
  const { origin } = headers;
  return origin === undefined || hosts.some((own) => origin === `http://${own}`);
};
