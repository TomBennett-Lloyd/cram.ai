import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { z } from 'zod';
import type { EncoderRole } from '../../role';

/** Sidecars read from the snapshot's root, as a Hugging Face repository lays them out. */
export const TOKENIZER_FILE = 'tokenizer.json';
export const TOKENIZER_CONFIG_FILE = 'tokenizer_config.json';
export const MODEL_CONFIG_FILE = 'config.json';

export type EncoderLoadFailureReason = 'unreadable-file' | 'digest-mismatch' | 'invalid-artefact';

/** Why an encoder did not load; every reason is the operator's to fix in the snapshot or the pin. */
export interface EncoderLoadFailure {
  readonly status: 'load-failed';
  readonly role: EncoderRole;
  readonly reason: EncoderLoadFailureReason;
  readonly detail: string;
}

export type EncoderLoad<T> =
  { readonly status: 'loaded'; readonly encoder: T } | EncoderLoadFailure;

/** Thrown inside a load and converted to an `EncoderLoadFailure` by `loadedOrRefused`, never past it. */
export class ArtefactRefused extends Error {
  readonly reason: EncoderLoadFailureReason;

  constructor(reason: EncoderLoadFailureReason, detail: string) {
    super(detail);
    this.name = 'ArtefactRefused';
    this.reason = reason;
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const unreadable = (path: string, error: unknown): ArtefactRefused =>
  new ArtefactRefused('unreadable-file', `${path}: ${describeError(error)}`);

export const invalid = (path: string, error: unknown): ArtefactRefused =>
  new ArtefactRefused('invalid-artefact', `${path}: ${describeError(error)}`);

export const sha256Of = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash).catch((error: unknown) => {
    throw unreadable(path, error);
  });
  return hash.digest('hex');
};

export const readJson = async <S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S>> => {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    throw unreadable(path, error);
  });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw invalid(path, error);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalid(path, parsed.error);
  return parsed.data;
};

/** The one boundary where `ArtefactRefused` becomes a value; anything else propagates. */
export const loadedOrRefused = async <T>(
  role: EncoderRole,
  load: () => Promise<T>,
): Promise<EncoderLoad<T>> => {
  try {
    return { status: 'loaded', encoder: await load() };
  } catch (error) {
    if (!(error instanceof ArtefactRefused)) throw error;
    return { status: 'load-failed', role, reason: error.reason, detail: error.message };
  }
};
