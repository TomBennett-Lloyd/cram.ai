import {
  type ChatRequest,
  type ChatResult,
  chatResult,
  chatWireRequest,
  type GeneratorReply,
} from './chat';
import {
  type EmbeddingResult,
  EmbedRequest,
  type EntailmentResult,
  EntailRequest,
  type RecordedEmbedding,
  RerankRequest,
  type RerankResult,
} from './encoder-requests';
import type { Embedder, Generator, ModelGateway, Reranker, Verifier } from './model-gateway';
import type { EmbedderPin, GeneratorPin, RerankerPin, VerifierPin } from './pin';
import { Recording, recordingKey } from './recording';
import type { Sampling } from './role-config';
import type { Role } from './role';

/** A replay with no recording; never a fallback (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)). */
export class RecordingMissError extends Error {
  readonly role: Role;
  readonly key: string;

  constructor(role: Role, key: string) {
    super(`FakeGateway: no ${role} recording matches this request and pin`);
    this.name = 'RecordingMissError';
    this.role = role;
    this.key = key;
  }
}

/** Runs `replay` inside the promise, so a miss rejects as a live backend's failure would. */
const replayed = <T>(replay: () => T): Promise<T> =>
  new Promise((resolve) => {
    resolve(replay());
  });

class Replies<R> {
  readonly #role: Role;
  readonly #byKey = new Map<string, R>();

  constructor(role: Role) {
    this.#role = role;
  }

  add(key: string, reply: R): void {
    if (this.#byKey.has(key))
      throw new Error(`FakeGateway: two ${this.#role} recordings share a key`);
    this.#byKey.set(key, reply);
  }

  replay(key: string): R {
    const reply = this.#byKey.get(key);
    if (reply === undefined) throw new RecordingMissError(this.#role, key);
    return reply;
  }
}

class FakeGenerator implements Generator {
  readonly pin: GeneratorPin;
  readonly #sampling: Sampling;
  readonly #replies: Replies<GeneratorReply>;

  constructor(pin: GeneratorPin, sampling: Sampling, replies: Replies<GeneratorReply>) {
    this.pin = pin;
    this.#sampling = sampling;
    this.#replies = replies;
  }

  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return replayed(() => {
      const sent = { pin: this.pin, sampling: this.#sampling, request: chatWireRequest(request) };
      return chatResult(this.#replies.replay(recordingKey(sent)), request.output.schema);
    });
  }
}

class FakeEmbedder implements Embedder {
  readonly pin: EmbedderPin;
  readonly #replies: Replies<readonly RecordedEmbedding[]>;

  constructor(pin: EmbedderPin, replies: Replies<readonly RecordedEmbedding[]>) {
    this.pin = pin;
    this.#replies = replies;
  }

  embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return replayed(() =>
      this.#replies
        .replay(recordingKey({ pin: this.pin, request: EmbedRequest.parse(request) }))
        .map((result) =>
          result.status === 'embedded'
            ? { status: 'embedded', vector: Float32Array.from(result.vector) }
            : result,
        ),
    );
  }
}

class FakeReranker implements Reranker {
  readonly pin: RerankerPin;
  readonly #replies: Replies<readonly RerankResult[]>;

  constructor(pin: RerankerPin, replies: Replies<readonly RerankResult[]>) {
    this.pin = pin;
    this.#replies = replies;
  }

  rerank(request: RerankRequest): Promise<readonly RerankResult[]> {
    return replayed(() =>
      this.#replies.replay(recordingKey({ pin: this.pin, request: RerankRequest.parse(request) })),
    );
  }
}

class FakeVerifier implements Verifier {
  readonly pin: VerifierPin;
  readonly #replies: Replies<readonly EntailmentResult[]>;

  constructor(pin: VerifierPin, replies: Replies<readonly EntailmentResult[]>) {
    this.pin = pin;
    this.#replies = replies;
  }

  entail(request: EntailRequest): Promise<readonly EntailmentResult[]> {
    return replayed(() =>
      this.#replies.replay(recordingKey({ pin: this.pin, request: EntailRequest.parse(request) })),
    );
  }
}

export interface FakeGatewayPins {
  readonly generator: GeneratorPin;
  readonly verifier: VerifierPin;
  readonly embedder: EmbedderPin;
  readonly reranker?: RerankerPin;
}

export interface FakeGatewaySpec {
  readonly pins: FakeGatewayPins;
  readonly sampling: Sampling;
  readonly recordings: readonly Recording[];
}

/** Replays recordings keyed as `Recording` states; a miss rejects with `RecordingMissError`. */
export class FakeGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;

  constructor(spec: FakeGatewaySpec) {
    const generator = new Replies<GeneratorReply>('generator');
    const embedder = new Replies<readonly RecordedEmbedding[]>('embedder');
    const reranker = new Replies<readonly RerankResult[]>('reranker');
    const verifier = new Replies<readonly EntailmentResult[]>('verifier');
    for (const recording of spec.recordings.map((r) => Recording.parse(r))) {
      const key = recordingKey(recording);
      switch (recording.role) {
        case 'generator':
          generator.add(key, recording.reply);
          break;
        case 'embedder':
          embedder.add(key, recording.reply.results);
          break;
        case 'reranker':
          reranker.add(key, recording.reply.results);
          break;
        case 'verifier':
          verifier.add(key, recording.reply.results);
          break;
      }
    }
    const { pins } = spec;
    this.generator = new FakeGenerator(pins.generator, spec.sampling, generator);
    this.verifier = new FakeVerifier(pins.verifier, verifier);
    this.embedder = new FakeEmbedder(pins.embedder, embedder);
    this.reranker = pins.reranker === undefined ? null : new FakeReranker(pins.reranker, reranker);
  }
}
