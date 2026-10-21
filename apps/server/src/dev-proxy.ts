import type { IncomingHttpHeaders } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { InlineConfig, ProxyOptions } from 'vite';
import { COURSES_PATH } from './routes';

/** Read by Vite as a directory, so `apps/web` stays out of this app's import graph (`docs/standards/architecture.md` rule 1). */
export const WEB_ROOT = fileURLToPath(new URL('../../web', import.meta.url));

/** The API's own origin for a page Vite served, else untouched; Vite has refused a foreign `Host` first. */
export const forwardedOrigin = (
  headers: IncomingHttpHeaders,
  apiOrigin: string,
): string | undefined => {
  const { origin, host } = headers;
  return host !== undefined && origin === `http://${host}` ? apiOrigin : origin;
};

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

/** `pnpm dev`'s Vite (`docs/adr/0002-deployables.md` § Decision (b)); `cors: false` keeps `loopback.ts`'s no-CORS rule. */
export const devServerConfig = (apiOrigin: string, root: string = WEB_ROOT): InlineConfig => ({
  root,
  server: { cors: false, proxy: apiProxy(apiOrigin) },
});
