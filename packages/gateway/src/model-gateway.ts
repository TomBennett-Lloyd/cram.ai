import type { ChatRequest, ChatResult } from './chat';
import type {
  EmbeddingResult,
  EmbedRequest,
  EntailmentResult,
  EntailRequest,
  RerankRequest,
  RerankResult,
} from './encoder-requests';
import type { EmbedderPin, GeneratorPin, RerankerPin, VerifierPin } from './pin';
import type { Sampling } from './role-config';

export interface Generator {
  readonly pin: GeneratorPin;
  /** What this generator samples with: what an eval report records, never a caller's copy (`.claude/ledgers/generator-sampling.ledger`). */
  readonly sampling: Sampling;
  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>>;
}

/** One result per text, in request order. */
export interface Embedder {
  readonly pin: EmbedderPin;
  embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]>;
}

/** One result per document, in request order; a higher score is more relevant. */
export interface Reranker {
  readonly pin: RerankerPin;
  rerank(request: RerankRequest): Promise<readonly RerankResult[]>;
}

/** One result per pair, in request order; scores are probabilities, never a `Verdict` (#13 maps them). */
export interface Verifier {
  readonly pin: VerifierPin;
  entail(request: EntailRequest): Promise<readonly EntailmentResult[]>;
}

/** One capability per role, `docs/adr/0003-model-roles-and-backends.md` § Decision (b); `reranker` is null when unconfigured. */
export interface ModelGateway {
  readonly generator: Generator;
  readonly verifier: Verifier;
  readonly embedder: Embedder;
  readonly reranker: Reranker | null;
}
