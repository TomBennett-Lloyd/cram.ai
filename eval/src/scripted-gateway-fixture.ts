import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  type ChatWireRequest,
  chatWireRequest,
  type Embedder,
  type EmbeddingResult,
  type EmbedRequest,
  type EntailmentResult,
  type EntailRequest,
  type GeneratorReply,
  PROVISIONAL_DEFAULT_PINS,
  type Reranker,
  RerankerPin,
  type RerankRequest,
  type Sampling,
  type ServedArtefact,
  type Verifier,
} from '@cram/gateway';
import type { RecordableGateway, RecordableGenerator } from './recording-gateway';

const pins = PROVISIONAL_DEFAULT_PINS;

export const SAMPLING: Sampling = { temperature: 0, seed: 0 };

/** A stand-in for a live backend in tests: replies are computed from the request. */
export type Respond = (wire: ChatWireRequest) => GeneratorReply;

export const SERVED: ServedArtefact = { status: 'unverified', reason: 'a scripted generator' };

class ScriptedGenerator implements RecordableGenerator {
  readonly pin = pins.generator;
  readonly sampling: Sampling;
  readonly served = SERVED;
  readonly #respond: Respond;

  constructor(respond: Respond, sampling: Sampling) {
    this.#respond = respond;
    this.sampling = sampling;
  }

  reply(wire: ChatWireRequest): Promise<GeneratorReply> {
    return Promise.resolve(this.#respond(wire));
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return chatResult(await this.reply(chatWireRequest(request)), request.output.schema);
  }
}

/** Letter counts: texts sharing letters lie close, which is all retrieval needs here. */
const letterVector = (text: string): Float32Array<ArrayBuffer> => {
  const vector = new Float32Array(26);
  for (const char of text.toLowerCase()) {
    const index = char.charCodeAt(0) - 'a'.charCodeAt(0);
    if (index >= 0 && index < 26) vector[index] = (vector[index] ?? 0) + 1;
  }
  return vector;
};

class ScriptedEmbedder implements Embedder {
  readonly pin = pins.embedder;

  embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return Promise.resolve(
      request.texts.map((text) => ({ status: 'embedded', vector: letterVector(text) })),
    );
  }
}

export const ENTAILED: EntailmentResult = {
  status: 'scored',
  scores: { entailment: 0.9, neutral: 0.05, contradiction: 0.05 },
};
export const NEUTRAL: EntailmentResult = {
  status: 'scored',
  scores: { entailment: 0.1, neutral: 0.8, contradiction: 0.1 },
};

/** Entailed exactly when the premise contains the hypothesis. */
class ScriptedVerifier implements Verifier {
  readonly pin = pins.verifier;

  entail(request: EntailRequest): Promise<readonly EntailmentResult[]> {
    return Promise.resolve(
      request.pairs.map(({ premise, hypothesis }) =>
        premise.includes(hypothesis) ? ENTAILED : NEUTRAL,
      ),
    );
  }
}

export const RERANKER_PIN = RerankerPin.parse({
  ...pins.verifier,
  role: 'reranker',
  model: 'BAAI/bge-reranker-base',
});

/** Scores each document by its length. */
export const LENGTH_RERANKER: Reranker = {
  pin: RERANKER_PIN,
  rerank: (request: RerankRequest) =>
    Promise.resolve(
      request.documents.map((document) => ({ status: 'scored', score: document.length })),
    ),
};

export class ScriptedGateway implements RecordableGateway {
  readonly generator: ScriptedGenerator;
  readonly verifier = new ScriptedVerifier();
  readonly embedder = new ScriptedEmbedder();
  readonly reranker: Reranker | null;

  constructor(respond: Respond, reranker: Reranker | null = null, sampling: Sampling = SAMPLING) {
    this.generator = new ScriptedGenerator(respond, sampling);
    this.reranker = reranker;
  }
}
