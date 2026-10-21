import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildGateway, composeServer, refusalMessage } from './compose-server';
import { apiProxy } from './dev-proxy';
import { developerDefaults } from './gateway-config';

/** Read by Vite as a directory, so `apps/web` stays out of this app's import graph (`docs/standards/architecture.md` rule 1). */
const WEB_ROOT = fileURLToPath(new URL('../../web', import.meta.url));

const say = (line: string): void => {
  process.stdout.write(`cram dev: ${line}\n`);
};

/** `pnpm dev` (`docs/adr/0002-deployables.md` § Decision (b)): the server, with Vite serving the SPA in front of it. */
const main = async (): Promise<number> => {
  const host = { platform: process.platform, env: process.env, homedir: homedir() };
  const composition = await composeServer({
    host,
    defaults: developerDefaults(host),
    port: 0,
    log: (entry) => {
      say(JSON.stringify(entry));
    },
    buildGateway,
  });
  if (composition.status !== 'started') {
    process.stderr.write(`cram dev: ${refusalMessage(composition)}\n`);
    return 1;
  }
  const { server, dataDir, overridden } = composition;
  say(`data directory ${dataDir}; gateway config ${overridden ? 'overridden' : 'defaults'}`);
  say(`API on ${server.origin}`);
  try {
    const vite = await createServer({ root: WEB_ROOT, server: { proxy: apiProxy(server.origin) } });
    await vite.listen();
    vite.printUrls();
    const stop = (): void => {
      void vite.close().then(() => server.close());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await server.close();
    throw error;
  }
  return 0;
};

process.exitCode = await main();
