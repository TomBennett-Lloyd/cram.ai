import type {
  ChatRequest,
  ChatResult,
  Embedder,
  EmbedderPin,
  EmbeddingResult,
  EmbedRequest,
  EntailmentResult,
  EntailRequest,
  Generator,
  GeneratorPin,
  ModelGateway,
  Reranker,
  RerankerPin,
  RerankRequest,
  RerankResult,
  Role,
  Sampling,
  Verifier,
  VerifierPin,
} from '@cram/gateway';
import { type Clock, timed } from './latency';

class Durations {
  readonly #byRole = new Map<Role, number[]>();

  add(role: Role, ms: number): void {
    const list = this.#byRole.get(role) ?? [];
    list.push(ms);
    this.#byRole.set(role, list);
  }

  of(role: Role): readonly number[] {
    return this.#byRole.get(role) ?? [];
  }
}

interface Timing {
  readonly clock: Clock;
  readonly durations: Durations;
}

const timedCall = <T>(timing: Timing, role: Role, call: () => Promise<T>): Promise<T> =>
  timed(
    timing.clock,
    (ms) => {
      timing.durations.add(role, ms);
    },
    call,
  );

class TimedGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly sampling: Sampling;
  readonly #inner: Generator;
  readonly #timing: Timing;

  constructor(inner: Generator, timing: Timing) {
    this.pin = inner.pin;
    this.sampling = inner.sampling;
    this.#inner = inner;
    this.#timing = timing;
  }

  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return timedCall(this.#timing, 'generator', () => this.#inner.chat(request));
  }
}

class TimedEmbedder implements Embedder {
  readonly pin: EmbedderPin;
  readonly #inner: Embedder;
  readonly #timing: Timing;

  constructor(inner: Embedder, timing: Timing) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#timing = timing;
  }

  embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return timedCall(this.#timing, 'embedder', () => this.#inner.embed(request));
  }
}

class TimedReranker implements Reranker {
  readonly pin: RerankerPin;
  readonly #inner: Reranker;
  readonly #timing: Timing;

  constructor(inner: Reranker, timing: Timing) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#timing = timing;
  }

  rerank(request: RerankRequest): Promise<readonly RerankResult[]> {
    return timedCall(this.#timing, 'reranker', () => this.#inner.rerank(request));
  }
}

class TimedVerifier implements Verifier {
  readonly pin: VerifierPin;
  readonly #inner: Verifier;
  readonly #timing: Timing;

  constructor(inner: Verifier, timing: Timing) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#timing = timing;
  }

  entail(request: EntailRequest): Promise<readonly EntailmentResult[]> {
    return timedCall(this.#timing, 'verifier', () => this.#inner.entail(request));
  }
}

/** Forwards every call and keeps each one's wall-clock duration, per role. */
export class TimedGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;
  readonly #durations = new Durations();

  constructor(inner: ModelGateway, clock: Clock) {
    const timing = { clock, durations: this.#durations };
    this.generator = new TimedGenerator(inner.generator, timing);
    this.verifier = new TimedVerifier(inner.verifier, timing);
    this.embedder = new TimedEmbedder(inner.embedder, timing);
    this.reranker = inner.reranker === null ? null : new TimedReranker(inner.reranker, timing);
  }

  durations(role: Role): readonly number[] {
    return this.#durations.of(role);
  }
}
