import {
  type EncoderLoadFailure,
  type GatewayConfig,
  loadOnnxEmbedder,
  loadOnnxReranker,
  loadOnnxVerifier,
  type ModelGateway,
  OpenAiHttpGenerator,
} from '@cram/gateway';
import { type DataDirectoryHost, resolveDataDir } from './data-directory';
import { readGatewayConfig } from './gateway-config';
import { type CramServer, startServer } from './server';
import type { ServerLog } from './server-log';

export type GatewayBuild =
  | { readonly status: 'built'; readonly gateway: ModelGateway }
  | { readonly status: 'load-failed'; readonly failures: readonly EncoderLoadFailure[] };

/** Every encoder is loaded before any refusal, so one start names every snapshot to fix. */
export const buildGateway = async (config: GatewayConfig): Promise<GatewayBuild> => {
  const [verifier, embedder, reranker] = await Promise.all([
    loadOnnxVerifier(config.verifier),
    loadOnnxEmbedder(config.embedder),
    config.reranker === undefined ? null : loadOnnxReranker(config.reranker),
  ]);
  if (
    verifier.status === 'loaded' &&
    embedder.status === 'loaded' &&
    (reranker === null || reranker.status === 'loaded')
  ) {
    return {
      status: 'built',
      gateway: {
        generator: new OpenAiHttpGenerator(config.generator),
        verifier: verifier.encoder,
        embedder: embedder.encoder,
        reranker: reranker === null ? null : reranker.encoder,
      },
    };
  }
  const failures = [verifier, embedder, reranker].flatMap((load) =>
    load !== null && load.status === 'load-failed' ? [load] : [],
  );
  return { status: 'load-failed', failures };
};

/** What a run mode supplies; `defaults` is that mode's roles (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)). */
export interface CompositionSpec {
  readonly host: DataDirectoryHost;
  readonly defaults: GatewayConfig;
  /** `0` lets the OS choose. */
  readonly port: number;
  readonly log: ServerLog;
  readonly buildGateway: (config: GatewayConfig) => Promise<GatewayBuild>;
}

export type Composition =
  | {
      readonly status: 'started';
      readonly server: CramServer;
      readonly dataDir: string;
      readonly overridden: boolean;
    }
  | { readonly status: 'relative-data-dir'; readonly value: string }
  | { readonly status: 'config-invalid'; readonly source: string; readonly issues: string }
  | { readonly status: 'load-failed'; readonly failures: readonly EncoderLoadFailure[] };

export type CompositionRefusal = Exclude<Composition, { readonly status: 'started' }>;

/** The composition root: data directory, then role config, then gateway, then `startServer`; each step can refuse the start. */
export const composeServer = async (spec: CompositionSpec): Promise<Composition> => {
  const dataDir = resolveDataDir(spec.host);
  if (dataDir.status === 'relative-override')
    return { status: 'relative-data-dir', value: dataDir.value };
  const read = await readGatewayConfig(dataDir.path, spec.defaults);
  if (read.status === 'invalid')
    return { status: 'config-invalid', source: read.source, issues: read.issues };
  const built = await spec.buildGateway(read.config);
  if (built.status === 'load-failed') return built;
  const server = await startServer({
    gateway: built.gateway,
    dataDir: dataDir.path,
    port: spec.port,
    log: spec.log,
  });
  return { status: 'started', server, dataDir: dataDir.path, overridden: read.overridden };
};

export const refusalMessage = (refusal: CompositionRefusal): string => {
  switch (refusal.status) {
    case 'relative-data-dir':
      return `CRAM_DATA_DIR must be an absolute path; it is '${refusal.value}'`;
    case 'config-invalid':
      return `the gateway config from ${refusal.source} is invalid:\n${refusal.issues}`;
    case 'load-failed':
      return refusal.failures
        .map(({ role, reason, detail }) => `the ${role} did not load (${reason}): ${detail}`)
        .join('\n');
  }
};
