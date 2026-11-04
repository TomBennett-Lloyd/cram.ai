import type {
  ChatRequest,
  ChatResult,
  CutOffAt,
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
  ServedArtefact,
  Verifier,
  VerifierPin,
} from '@cram/gateway';
import { z } from 'zod';
import { type Clock, timed } from './latency';

const Count = z.number().int().nonnegative();

export const GeneratorCutOffs = z.strictObject({ tokenLimit: Count, timeout: Count });
export type GeneratorCutOffs = z.infer<typeof GeneratorCutOffs>;

const CUT_OFF_KEY = {
  'token-limit': 'tokenLimit',
  timeout: 'timeout',
} as const satisfies Record<CutOffAt, keyof GeneratorCutOffs>;

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
  readonly cutOffs: Record<keyof GeneratorCutOffs, number>;
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
  readonly maxOutputTokens: number;
  readonly served: ServedArtefact;
  readonly #inner: Generator;
  readonly #timing: Timing;

  constructor(inner: Generator, timing: Timing) {
    this.pin = inner.pin;
    this.sampling = inner.sampling;
    this.maxOutputTokens = inner.maxOutputTokens;
    this.served = inner.served;
    this.#inner = inner;
    this.#timing = timing;
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    const result = await timedCall(this.#timing, 'generator', () => this.#inner.chat(request));
    if (result.status === 'cut-off') this.#timing.cutOffs[CUT_OFF_KEY[result.cutOffAt]] += 1;
    return result;
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

/** Forwards every call and keeps each one's wall-clock duration, per role, and its generator cut-offs. */
export class TimedGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;
  readonly #durations = new Durations();
  readonly #cutOffs = { tokenLimit: 0, timeout: 0 };

  constructor(inner: ModelGateway, clock: Clock) {
    const timing = { clock, durations: this.#durations, cutOffs: this.#cutOffs };
    this.generator = new TimedGenerator(inner.generator, timing);
    this.verifier = new TimedVerifier(inner.verifier, timing);
    this.embedder = new TimedEmbedder(inner.embedder, timing);
    this.reranker = inner.reranker === null ? null : new TimedReranker(inner.reranker, timing);
  }

  durations(role: Role): readonly number[] {
    return this.#durations.of(role);
  }

  cutOffs(): GeneratorCutOffs {
    return { ...this.#cutOffs };
  }
}
