import { join } from 'node:path';
import { z } from 'zod';
import { type ModelPin, PROVISIONAL_DEFAULT_PINS, GatewayConfig, Sampling } from '@cram/gateway';
import { MachineClass } from './report';

/** The backend's deterministic settings (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)). */
export const LIVE_SAMPLING: Sampling = Sampling.parse({ temperature: 0, seed: 0 });

/** One generator call's bound; a CPU-only machine takes minutes over a long prompt (#3). */
const GENERATOR_TIMEOUT_MS = 600_000;

/** The pins a live run is configured with, and so the ones its replay is keyed by. */
export const LIVE_PINS = PROVISIONAL_DEFAULT_PINS;

/**
 * What `pnpm eval` reads from its environment: the generator as `pnpm models:pull` prints it, and
 * the directory holding one snapshot per encoder pin's `artefact.repository`.
 */
export const LiveEnvironment = z.object({
  CRAM_GENERATOR_ENDPOINT: z.string(),
  CRAM_GENERATOR_MODEL: z.string(),
  CRAM_MODELS_DIR: z.string(),
});

/** What the report says of the run that `pnpm eval` cannot know itself (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)). */
export const RunEnvironment = z.object({
  CRAM_EVAL_PR: z.coerce.number().int().positive(),
  CRAM_MACHINE_CLASS: MachineClass,
});

export type LiveConfig =
  | { readonly status: 'configured'; readonly config: GatewayConfig }
  | { readonly status: 'unconfigured'; readonly message: string };

const snapshot = (modelsDir: string, pin: ModelPin): string =>
  join(modelsDir, pin.artefact.repository);

/** The live gateway's role config over the provisional pins; no reranker, as they configure none. */
export const liveConfig = (env: Readonly<Record<string, string | undefined>>): LiveConfig => {
  const read = LiveEnvironment.safeParse(env);
  if (!read.success) return { status: 'unconfigured', message: z.prettifyError(read.error) };
  const { CRAM_GENERATOR_ENDPOINT, CRAM_GENERATOR_MODEL, CRAM_MODELS_DIR } = read.data;
  const config = GatewayConfig.safeParse({
    generator: {
      pin: LIVE_PINS.generator,
      endpoint: CRAM_GENERATOR_ENDPOINT,
      servedModel: CRAM_GENERATOR_MODEL,
      timeoutMs: GENERATOR_TIMEOUT_MS,
      sampling: LIVE_SAMPLING,
    },
    verifier: { pin: LIVE_PINS.verifier, directory: snapshot(CRAM_MODELS_DIR, LIVE_PINS.verifier) },
    embedder: { pin: LIVE_PINS.embedder, directory: snapshot(CRAM_MODELS_DIR, LIVE_PINS.embedder) },
  });
  return config.success
    ? { status: 'configured', config: config.data }
    : { status: 'unconfigured', message: z.prettifyError(config.error) };
};
