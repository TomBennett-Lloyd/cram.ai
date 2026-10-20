import { RerankRequest, type RerankResult } from '../../encoder-requests';
import type { Reranker } from '../../model-gateway';
import type { RerankerPin } from '../../pin';
import { RerankerConfig } from '../../role-config';
import { type EncoderLoad, loadedOrRefused } from './encoder-artefact';
import {
  brokenInvariant,
  type EncoderSession,
  logitsOf,
  openEncoderSession,
} from './encoder-session';

/** Scores are the model's raw logit: monotone in relevance, which is all `Reranker` promises. */
export class OnnxReranker implements Reranker {
  readonly pin: RerankerPin;
  readonly #session: EncoderSession;

  constructor(pin: RerankerPin, session: EncoderSession) {
    this.pin = pin;
    this.#session = session;
  }

  /** The query is the first segment and each document the second. */
  async rerank(request: RerankRequest): Promise<readonly RerankResult[]> {
    const { query, documents } = RerankRequest.parse(request);
    const results: RerankResult[] = [];
    for (const document of documents) {
      const output = await this.#session.run(query, document);
      if (output.status === 'over-length') {
        results.push(output);
        continue;
      }
      const score = logitsOf(output, 1)?.[0];
      if (score === undefined) throw brokenInvariant('OnnxReranker', output);
      results.push({ status: 'scored', score });
    }
    return results;
  }
}

export const loadOnnxReranker = async (
  config: RerankerConfig,
): Promise<EncoderLoad<OnnxReranker>> => {
  const { pin, directory } = RerankerConfig.parse(config);
  return loadedOrRefused('reranker', async () => {
    const session = await openEncoderSession({ pin, directory, output: 'logits' });
    await session.probe((output) => logitsOf(output, 1) !== null, '');
    return new OnnxReranker(pin, session);
  });
};
