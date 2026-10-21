import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GatewayConfig, type GeneratorPin, PROVISIONAL_DEFAULT_PINS } from '@cram/gateway';
import { z } from 'zod';
import type { DataDirectoryHost } from './data-directory';

/** Read from the data directory, so outside the repo (`docs/adr/0003-model-roles-and-backends.md` § Decision (f)). */
export const GATEWAY_CONFIG_FILE = 'gateway.json';

/** A role the file names replaces that role's default whole; the merge is then parsed by `GatewayConfig`. */
export const GatewayOverrides = GatewayConfig.partial();
export type GatewayOverrides = z.infer<typeof GatewayOverrides>;

// Developer mode's generator endpoint; its carriers are in .claude/ledgers/dev-generator-endpoint.ledger.
const DEVELOPER_ENDPOINT = 'http://127.0.0.1:11434/v1/';

/** A bound, not a measurement: per-role latency is #47's to record. */
const GENERATOR_TIMEOUT_MS = 300_000;

/** `docs/adr/0005-evaluation-as-gate.md` § Decision (e): the backend's deterministic settings. */
const DETERMINISTIC_SAMPLING = { temperature: 0, seed: 0 };

const SERVED_DIGEST_CHARS = 12;

/** The name `pnpm models:pull` imports the pin's GGUF under (.claude/ledgers/dev-served-model-name.ledger). */
export const servedModelName = (pin: GeneratorPin): string =>
  `${pin.artefact.file.replace(/\.gguf$/, '')}-${pin.sha256.slice(0, SERVED_DIGEST_CHARS)}`.toLowerCase();

/** Where `pnpm models:pull` puts weights (.claude/ledgers/dev-models-directory.ledger). */
export const developerModelsDirectory = ({ env, homedir }: DataDirectoryHost): string => {
  const override = env.CRAM_MODELS_DIR;
  return override === undefined || override === ''
    ? join(homedir, '.local', 'share', 'cram', 'models')
    : override;
};

/** Developer mode's roles (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)): Ollama on loopback, encoders in-process. */
export const developerDefaults = (host: DataDirectoryHost): GatewayConfig => {
  const models = developerModelsDirectory(host);
  const { generator, verifier, embedder } = PROVISIONAL_DEFAULT_PINS;
  return {
    generator: {
      pin: generator,
      endpoint: DEVELOPER_ENDPOINT,
      servedModel: servedModelName(generator),
      timeoutMs: GENERATOR_TIMEOUT_MS,
      sampling: DETERMINISTIC_SAMPLING,
    },
    verifier: { pin: verifier, directory: join(models, verifier.artefact.repository) },
    embedder: { pin: embedder, directory: join(models, embedder.artefact.repository) },
  };
};

export type GatewayConfigRead =
  | { readonly status: 'read'; readonly config: GatewayConfig; readonly overridden: boolean }
  /** `source` is the file's path, or `defaults` when no file exists and the defaults themselves fail. */
  | { readonly status: 'invalid'; readonly source: string; readonly issues: string };

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const overridesText = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

type JsonParse =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

const parsedJson = (text: string): JsonParse => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, message: error.message };
    throw error;
  }
};

/** The defaults, overridden by the data directory's `GATEWAY_CONFIG_FILE` when it exists; any other read failure throws. */
export const readGatewayConfig = async (
  dataDir: string,
  defaults: GatewayConfig,
): Promise<GatewayConfigRead> => {
  const path = join(dataDir, GATEWAY_CONFIG_FILE);
  const text = await overridesText(path);
  let overrides: GatewayOverrides = {};
  if (text !== null) {
    const json = parsedJson(text);
    if (!json.ok) return { status: 'invalid', source: path, issues: json.message };
    const parsed = GatewayOverrides.safeParse(json.value);
    if (!parsed.success)
      return { status: 'invalid', source: path, issues: z.prettifyError(parsed.error) };
    overrides = parsed.data;
  }
  const merged = GatewayConfig.safeParse({ ...defaults, ...overrides });
  return merged.success
    ? { status: 'read', config: merged.data, overridden: text !== null }
    : {
        status: 'invalid',
        source: text === null ? 'defaults' : path,
        issues: z.prettifyError(merged.error),
      };
};
