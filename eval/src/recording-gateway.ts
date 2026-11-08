import { isDeepStrictEqual } from 'node:util';
import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  type ChatWireRequest,
  chatWireRequest,
  type Embedder,
  type EmbedderPin,
  type EmbeddingResult,
  EmbedRequest,
  type EntailmentResult,
  EntailRequest,
  type Generator,
  type GeneratorPin,
  type GeneratorReply,
  type ModelGateway,
  Recording,
  recordingKey,
  type Reranker,
  type RerankerPin,
  RerankRequest,
  type RerankResult,
  type Sampling,
  type ServedArtefact,
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
}

export type RecordingsResult =
  | { readonly status: 'recorded'; readonly recordings: readonly Recording[] }
  | { readonly status: 'nondeterministic'; readonly first: Recording; readonly second: Recording };

/** Each distinct call once, first reply kept; a call the first reply would replay differently is a conflict, never either (#732). */
class RecordingLog {
  readonly #byKey = new Map<string, Recording>();
  #conflict: { readonly first: Recording; readonly second: Recording } | undefined;

  add(recording: Recording): void {
    const parsed = Recording.parse(recording);
    this.#add(parsed, (first) => isDeepStrictEqual(first.reply, parsed.reply));
  }

  addChat<T>(recording: Recording, request: ChatRequest<T>, result: ChatResult<T>): void {
    this.#add(
      Recording.parse(recording),
      (first) =>
        first.role === 'generator' &&
        isDeepStrictEqual(chatResult(first.reply, request.output.schema), result),
    );
  }

  #add(recording: Recording, replays: (first: Recording) => boolean): void {
    const key = recordingKey(recording);
    const first = this.#byKey.get(key);
    if (first === undefined) this.#byKey.set(key, recording);
    else if (this.#conflict === undefined && !replays(first))
      this.#conflict = { first, second: recording };
  }

  result(): RecordingsResult {
    return this.#conflict === undefined
      ? { status: 'recorded', recordings: [...this.#byKey.values()] }
      : { status: 'nondeterministic', ...this.#conflict };
  }
}

class RecordingGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly sampling: Sampling;
  readonly maxOutputTokens: number;
  readonly served: ServedArtefact;
  readonly #inner: RecordableGenerator;
  readonly #log: RecordingLog;

  constructor(inner: RecordableGenerator, log: RecordingLog) {
    this.pin = inner.pin;
    this.sampling = inner.sampling;
    this.maxOutputTokens = inner.maxOutputTokens;
    this.served = inner.served;
    this.#inner = inner;
    this.#log = log;
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    const wire = chatWireRequest(request);
    const reply = await this.#inner.reply(wire);
    const result = chatResult(reply, request.output.schema);
    this.#log.addChat(
      {
        role: 'generator',
        pin: this.pin,
        sampling: this.sampling,
        maxOutputTokens: this.maxOutputTokens,
        request: wire,
        reply,
      },
      request,
      result,
    );
    return result;
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

  async embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    const sent = EmbedRequest.parse(request);
    const results = await this.#inner.embed(sent);
    this.#log.add({
      role: 'embedder',
      pin: this.pin,
      request: sent,
      reply: {
        results: results.map((result) =>
          result.status === 'embedded'
            ? { status: 'embedded', vector: Array.from(result.vector) }
            : result,
        ),
      },
    });
    return results;
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

  async rerank(request: RerankRequest): Promise<readonly RerankResult[]> {
    const sent = RerankRequest.parse(request);
    const results = await this.#inner.rerank(sent);
    this.#log.add({
      role: 'reranker',
      pin: this.pin,
      request: sent,
      reply: { results: [...results] },
    });
    return results;
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
 * Records every call it forwards under `recordingKey`, the key `FakeGateway` replays it by
 * (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)). A call that rejects records nothing.
 */
export class RecordingGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;
  readonly #log = new RecordingLog();

  constructor({ inner }: RecordingGatewaySpec) {
    this.generator = new RecordingGenerator(inner.generator, this.#log);
    this.verifier = new RecordingVerifier(inner.verifier, this.#log);
    this.embedder = new RecordingEmbedder(inner.embedder, this.#log);
    this.reranker =
      inner.reranker === null ? null : new RecordingReranker(inner.reranker, this.#log);
  }

  recordings(): RecordingsResult {
    return this.#log.result();
  }
}
