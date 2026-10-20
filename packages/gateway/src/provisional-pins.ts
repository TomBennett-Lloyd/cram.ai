import { EmbedderPin, GeneratorPin, VerifierPin } from './pin';

/**
 * The provisional default per role, `docs/adr/0003-model-roles-and-backends.md` § Decision (g);
 * no reranker by default. Digests are A2's command's output; re-pinning is argued by an eval report.
 */
export const PROVISIONAL_DEFAULT_PINS = {
  generator: GeneratorPin.parse({
    role: 'generator',
    backend: 'openai-compatible-http',
    model: 'Qwen/Qwen3-4B',
    artefact: { repository: 'Qwen/Qwen3-4B-GGUF', file: 'Qwen3-4B-Q4_K_M.gguf' },
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    licence: 'Apache-2.0',
  }),
  verifier: VerifierPin.parse({
    role: 'verifier',
    backend: 'onnxruntime',
    model: 'cross-encoder/nli-deberta-v3-base',
    artefact: { repository: 'cross-encoder/nli-deberta-v3-base', file: 'onnx/model.onnx' },
    sha256: '369ebf04fce8206c83b8fd62e9dc860144f10351a7f885ed3076beb17b7c6dda',
    licence: 'Apache-2.0',
  }),
  embedder: EmbedderPin.parse({
    role: 'embedder',
    backend: 'onnxruntime',
    model: 'BAAI/bge-small-en-v1.5',
    artefact: { repository: 'BAAI/bge-small-en-v1.5', file: 'onnx/model.onnx' },
    sha256: '828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35',
    licence: 'MIT',
  }),
} as const;
