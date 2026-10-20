import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  type ChatWireRequest,
  chatWireRequest,
  type Embedder,
  type EmbedderPin,
  EmbedRequest,
  type EntailmentResult,
  EntailRequest,
  type Generator,
  type GeneratorPin,
  type GeneratorReply,
  type ModelGateway,
  Recording,
  type Reranker,
  type RerankerPin,
  RerankRequest,
  type Sampling,
  type Verifier,
  type VerifierPin,
} from '@cram/gateway';

/** A generator whose reply can be read before parsing: what a recording stores (`OpenAiHttpGenerator.reply`). */
export interface RecordableGenerator extends Generator {
  reply(wire: ChatWireRequest): Promise<GeneratorReply>;
}

export interface RecordableGateway extends Omit<ModelGateway, 'generator'> {
  readonly generator: RecordableGenerator;
}

export interface RecordingGatewaySpec {
  readonly inner: RecordableGateway;
  /** What the inner generator samples with; part of a generator recording's key. */
  readonly sampling: Sampling;
}

export type RecordingsResult =
  | { readonly status: 'recorded'; readonly recordings: readonly Recording[] }
  | { readonly status: 'nondeterministic'; readonly first: Recording; readonly second: Recording };

/** Everything but the reply, which is what `FakeGateway` replays a recording by. */
const sentOf = (recording: Recording): string => JSON.stringify({ ...recording, reply: null });

/** Each distinct call once; the same call answered two ways is kept as a conflict, never as either answer. */
class RecordingLog {
  readonly #bySent = new Map<string, Recording>();
  #conflict: { readonly first: Recording; readonly second: Recording } | undefined;

  add(recording: Recording): void {
    const parsed = Recording.parse(recording);
    const sent = sentOf(parsed);
    const first = this.#bySent.get(sent);
    if (first === undefined) this.#bySent.set(sent, parsed);
    else if (this.#conflict === undefined && JSON.stringify(first) !== JSON.stringify(parsed))
      this.#conflict = { first, second: parsed };
  }

  result(): RecordingsResult {
    return this.#conflict === undefined
      ? { status: 'recorded', recordings: [...this.#bySent.values()] }
      : { status: 'nondeterministic', ...this.#conflict };
  }
}

class RecordingGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly #inner: RecordableGenerator;
  readonly #sampling: Sampling;
  readonly #log: RecordingLog;

  constructor(inner: RecordableGenerator, sampling: Sampling, log: RecordingLog) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#sampling = sampling;
    this.#log = log;
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    const wire = chatWireRequest(request);
    const reply = await this.#inner.reply(wire);
    this.#log.add({
      role: 'generator',
      pin: this.pin,
      sampling: this.#sampling,
      request: wire,
      reply,
    });
    return chatResult(reply, request.output.schema);
  }
}

class RecordingEmbedder implements Embedder {
  readonly pin: EmbedderPin;
  readonly #inner: Embedder;
  readonly #log: RecordingLog;

  constructor(inner: Embedder, log: RecordingLog) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#log = log;
  }

  async embed(request: EmbedRequest): Promise<readonly Float32Array[]> {
    const sent = EmbedRequest.parse(request);
    const vectors = await this.#inner.embed(sent);
    this.#log.add({
      role: 'embedder',
      pin: this.pin,
      request: sent,
      reply: { vectors: vectors.map((vector) => Array.from(vector)) },
    });
    return vectors;
  }
}

class RecordingReranker implements Reranker {
  readonly pin: RerankerPin;
  readonly #inner: Reranker;
  readonly #log: RecordingLog;

  constructor(inner: Reranker, log: RecordingLog) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#log = log;
  }

  async rerank(request: RerankRequest): Promise<readonly number[]> {
    const sent = RerankRequest.parse(request);
    const scores = await this.#inner.rerank(sent);
    this.#log.add({
      role: 'reranker',
      pin: this.pin,
      request: sent,
      reply: { scores: [...scores] },
    });
    return scores;
  }
}

class RecordingVerifier implements Verifier {
  readonly pin: VerifierPin;
  readonly #inner: Verifier;
  readonly #log: RecordingLog;

  constructor(inner: Verifier, log: RecordingLog) {
    this.pin = inner.pin;
    this.#inner = inner;
    this.#log = log;
  }

  async entail(request: EntailRequest): Promise<readonly EntailmentResult[]> {
    const sent = EntailRequest.parse(request);
    const results = await this.#inner.entail(sent);
    this.#log.add({
      role: 'verifier',
      pin: this.pin,
      request: sent,
      reply: { results: [...results] },
    });
    return results;
  }
}

/**
 * Records every call it forwards, keyed by the full request content as `FakeGateway` replays it
 * (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)). A call that rejects records nothing.
 */
export class RecordingGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;
  readonly #log = new RecordingLog();

  constructor({ inner, sampling }: RecordingGatewaySpec) {
    this.generator = new RecordingGenerator(inner.generator, sampling, this.#log);
    this.verifier = new RecordingVerifier(inner.verifier, this.#log);
    this.embedder = new RecordingEmbedder(inner.embedder, this.#log);
    this.reranker =
      inner.reranker === null ? null : new RecordingReranker(inner.reranker, this.#log);
  }

  recordings(): RecordingsResult {
    return this.#log.result();
  }
}
