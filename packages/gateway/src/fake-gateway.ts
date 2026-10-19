import { canonicalJson } from './canonical-json';
import { type ChatRequest, type ChatResult, chatOutcome, chatWireRequest } from './chat';
import {
  EmbedRequest,
  type EntailmentResult,
  EntailRequest,
  RerankRequest,
} from './encoder-requests';
import type { Embedder, Generator, ModelGateway, Reranker, Verifier } from './model-gateway';
import type { EmbedderPin, GeneratorPin, ModelPin, RerankerPin, VerifierPin } from './pin';
import { type GeneratorReply, Recording } from './recording';
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

const keyOf = (pin: ModelPin, request: unknown): string => canonicalJson({ pin, request });

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
  readonly #replies: Replies<GeneratorReply>;

  constructor(pin: GeneratorPin, replies: Replies<GeneratorReply>) {
    this.pin = pin;
    this.#replies = replies;
  }

  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return replayed(() => {
      const reply = this.#replies.replay(keyOf(this.pin, chatWireRequest(request)));
      return reply.status === 'content' ? chatOutcome(reply.content, request.output.schema) : reply;
    });
  }
}

class FakeEmbedder implements Embedder {
  readonly pin: EmbedderPin;
  readonly #replies: Replies<readonly (readonly number[])[]>;

  constructor(pin: EmbedderPin, replies: Replies<readonly (readonly number[])[]>) {
    this.pin = pin;
    this.#replies = replies;
  }

  embed(request: EmbedRequest): Promise<readonly Float32Array[]> {
    return replayed(() =>
      this.#replies
        .replay(keyOf(this.pin, EmbedRequest.parse(request)))
        .map((vector) => Float32Array.from(vector)),
    );
  }
}

class FakeReranker implements Reranker {
  readonly pin: RerankerPin;
  readonly #replies: Replies<readonly number[]>;

  constructor(pin: RerankerPin, replies: Replies<readonly number[]>) {
    this.pin = pin;
    this.#replies = replies;
  }

  rerank(request: RerankRequest): Promise<readonly number[]> {
    return replayed(() => this.#replies.replay(keyOf(this.pin, RerankRequest.parse(request))));
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
    return replayed(() => this.#replies.replay(keyOf(this.pin, EntailRequest.parse(request))));
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
  readonly recordings: readonly Recording[];
}

/** Replays recordings keyed by pin and full request content; a miss throws `RecordingMissError`. */
export class FakeGateway implements ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;

  constructor(spec: FakeGatewaySpec) {
    const generator = new Replies<GeneratorReply>('generator');
    const embedder = new Replies<readonly (readonly number[])[]>('embedder');
    const reranker = new Replies<readonly number[]>('reranker');
    const verifier = new Replies<readonly EntailmentResult[]>('verifier');
    for (const recording of spec.recordings.map((r) => Recording.parse(r))) {
      const key = keyOf(recording.pin, recording.request);
      switch (recording.role) {
        case 'generator':
          generator.add(key, recording.reply);
          break;
        case 'embedder':
          embedder.add(key, recording.reply.vectors);
          break;
        case 'reranker':
          reranker.add(key, recording.reply.scores);
          break;
        case 'verifier':
          verifier.add(key, recording.reply.results);
          break;
      }
    }
    const { pins } = spec;
    this.generator = new FakeGenerator(pins.generator, generator);
    this.verifier = new FakeVerifier(pins.verifier, verifier);
    this.embedder = new FakeEmbedder(pins.embedder, embedder);
    this.reranker = pins.reranker === undefined ? null : new FakeReranker(pins.reranker, reranker);
  }
}
