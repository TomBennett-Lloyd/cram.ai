import { type EmbeddingResult, EmbedRequest } from '../../encoder-requests';
import type { Embedder } from '../../model-gateway';
import type { EmbedderPin } from '../../pin';
import { EmbedderConfig, type Pooling } from '../../role-config';
import { type EncoderLoad, loadedOrRefused } from './encoder-artefact';
import { brokenInvariant, type EncoderSession, openEncoderSession } from './encoder-session';
import { pooledVector } from './pooling';

/** `[tokens, width]` of a single input's `[1, tokens, width]` hidden state. */
const hiddenStateShape = (dims: readonly number[]): readonly [number, number] | null => {
  const [, tokens, width] = dims;
  return dims.length === 3 && tokens !== undefined && width !== undefined && width > 0
    ? [tokens, width]
    : null;
};

export class OnnxEmbedder implements Embedder {
  readonly pin: EmbedderPin;
  readonly #session: EncoderSession;
  readonly #pooling: Pooling;

  constructor(pin: EmbedderPin, session: EncoderSession, pooling: Pooling) {
    this.pin = pin;
    this.#session = session;
    this.#pooling = pooling;
  }

  async embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of EmbedRequest.parse(request).texts) {
      const output = await this.#session.run(text);
      if (output.status === 'over-length') {
        results.push(output);
        continue;
      }
      const shape = hiddenStateShape(output.dims);
      if (shape === null) throw brokenInvariant('OnnxEmbedder', output);
      results.push({
        status: 'embedded',
        vector: pooledVector(output.data, ...shape, this.#pooling),
      });
    }
    return results;
  }
}

export const loadOnnxEmbedder = async (
  config: EmbedderConfig,
): Promise<EncoderLoad<OnnxEmbedder>> => {
  const { pin, directory, pooling } = EmbedderConfig.parse(config);
  return loadedOrRefused('embedder', async () => {
    const session = await openEncoderSession({ pin, directory, output: 'last_hidden_state' });
    await session.probe((output) => hiddenStateShape(output.dims) !== null);
    return new OnnxEmbedder(pin, session, pooling);
  });
};
