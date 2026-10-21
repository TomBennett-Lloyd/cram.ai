import type { IncomingHttpHeaders } from 'node:http';
import type { ProxyOptions } from 'vite';
import { COURSES_PATH } from './routes';

/**
 * Its own origin for a page the dev server served, any other untouched for `isOwnOriginRequest`
 * to refuse; Vite's `server.allowedHosts` has already refused a foreign `Host`.
 */
export const forwardedOrigin = (
  headers: IncomingHttpHeaders,
  apiOrigin: string,
): string | undefined => {
  const { origin, host } = headers;
  return host !== undefined && origin === `http://${host}` ? apiOrigin : origin;
};

/** `pnpm dev`'s proxy to the API (`docs/adr/0002-deployables.md` § Decision (b)). */
export const apiProxy = (apiOrigin: string): Record<string, ProxyOptions> => ({
  [COURSES_PATH]: {
    target: apiOrigin,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyRequest, request) => {
        const origin = forwardedOrigin(request.headers, apiOrigin);
        if (origin !== undefined) proxyRequest.setHeader('origin', origin);
      });
    },
  },
});
