import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import { InferenceSession, type OnnxValue, Tensor } from 'onnxruntime-node';
import { z } from 'zod';
import type { OverLength } from '../../encoder-requests';
import { type EncoderPin, TOKENIZER_CONFIG_FILE, TOKENIZER_FILE } from '../../pin';
import { invalid, readJson, verifyManifest } from './encoder-artefact';
import { encodeInput } from './input-encoding';

/** `z.int()` admits only safe integers, so Hugging Face's "unset" sentinel is refused; the load probe refuses one too small. */
const TokenizerConfig = z.looseObject({ model_max_length: z.int() });
const TokenizerJson = z.record(z.string(), z.unknown());

export interface FloatOutput {
  readonly status: 'ran';
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

const floatOutput = (value: OnnxValue | undefined): FloatOutput | null =>
  value instanceof Tensor && value.data instanceof Float32Array
    ? { status: 'ran', data: value.data, dims: value.dims }
    : null;

const int64 = (values: readonly number[]): Tensor =>
  new Tensor('int64', BigInt64Array.from(values, BigInt), [1, values.length]);

export interface EncoderSessionSpec {
  readonly pin: EncoderPin;
  readonly directory: string;
  /** `last_hidden_state` for the embedder, `logits` for a classifier head. */
  readonly output: string;
}

/** `logits` of a single input's `[1, classes]` classifier head. */
export const logitsOf = (output: FloatOutput, classes: number): Float32Array | null =>
  output.dims.length === 2 && output.dims[1] === classes ? output.data : null;

export const brokenInvariant = (encoder: string, output: FloatOutput): Error =>
  new Error(`${encoder}: output shape [${output.dims.join(', ')}] changed after the load probe`);

export interface EncoderSessionParts {
  readonly session: InferenceSession;
  readonly tokenizer: Tokenizer;
  readonly maxInputTokens: number;
  readonly modelPath: string;
  readonly output: string;
}

/** One pinned encoder: its verified session, tokenizer and maximum input length. */
export class EncoderSession {
  readonly maxInputTokens: number;
  readonly #session: InferenceSession;
  readonly #tokenizer: Tokenizer;
  readonly #modelPath: string;
  readonly #output: string;

  constructor(parts: EncoderSessionParts) {
    this.#session = parts.session;
    this.#tokenizer = parts.tokenizer;
    this.maxInputTokens = parts.maxInputTokens;
    this.#modelPath = parts.modelPath;
    this.#output = parts.output;
  }

  /**
   * Runs one text, or one pair, alone: a batch of one, so no result depends on what else was in
   * the request (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)).
   */
  async run(text: string, pair?: string): Promise<FloatOutput | OverLength> {
    const encoding = encodeInput(this.#tokenizer, text, pair);
    const inputTokens = encoding.ids.length;
    if (inputTokens > this.maxInputTokens) {
      return { status: 'over-length', inputTokens, maxInputTokens: this.maxInputTokens };
    }
    const byName = {
      input_ids: encoding.ids,
      attention_mask: encoding.attentionMask,
      token_type_ids: encoding.tokenTypeIds,
    };
    const feeds = Object.fromEntries(
      Object.entries(byName)
        .filter(([name]) => this.#session.inputNames.includes(name))
        .map(([name, values]) => [name, int64(values)]),
    );
    const output = floatOutput((await this.#session.run(feeds))[this.#output]);
    if (output === null) throw new Error(`EncoderSession: no float32 output ${this.#output}`);
    return output;
  }

  /**
   * Runs the empty input at load, refusing an artefact that cannot take it or answers in a shape
   * `accepts` refuses; the input is fixed, so any failure is the artefact's.
   */
  async probe(accepts: (output: FloatOutput) => boolean, pair?: string): Promise<void> {
    const output = await this.run('', pair).catch((error: unknown) => {
      throw invalid(this.#modelPath, error);
    });
    if (output.status === 'over-length') {
      const { maxInputTokens, inputTokens } = output;
      throw invalid(
        this.#modelPath,
        `model_max_length ${String(maxInputTokens)} is below the ${String(inputTokens)}-token probe`,
      );
    }
    if (!accepts(output)) {
      throw invalid(this.#modelPath, `probe output has shape [${output.dims.join(', ')}]`);
    }
  }
}

/** Opens the pinned encoder once its whole manifest is verified. */
export const openEncoderSession = async (spec: EncoderSessionSpec): Promise<EncoderSession> => {
  await verifyManifest(spec.directory, spec.pin);
  const modelPath = join(spec.directory, spec.pin.artefact.file);
  const tokenizerPath = join(spec.directory, TOKENIZER_FILE);
  const tokenizerJson = await readJson(tokenizerPath, TokenizerJson);
  const tokenizerConfigPath = join(spec.directory, TOKENIZER_CONFIG_FILE);
  const tokenizerConfig = await readJson(tokenizerConfigPath, TokenizerConfig);
  let tokenizer: Tokenizer;
  try {
    tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  } catch (error) {
    throw invalid(tokenizerPath, error);
  }
  let session: InferenceSession;
  try {
    session = await InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  } catch (error) {
    throw invalid(modelPath, error);
  }
  if (!session.inputNames.includes('input_ids')) {
    throw invalid(modelPath, `inputs ${session.inputNames.join(', ')} do not read input_ids`);
  }
  return new EncoderSession({
    session,
    tokenizer,
    maxInputTokens: tokenizerConfig.model_max_length,
    modelPath,
    output: spec.output,
  });
};
