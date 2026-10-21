import {
  EmbedderPin,
  GeneratorPin,
  MODEL_CONFIG_FILE,
  TOKENIZER_CONFIG_FILE,
  TOKENIZER_FILE,
  VerifierPin,
} from './pin';

/**
 * The provisional default per role, `docs/adr/0003-model-roles-and-backends.md` § Decision (g);
 * no reranker by default. File digests are A2's commands' output, and the embedder's pooling is its
 * snapshot's `1_Pooling/config.json`; re-pinning is argued by an eval report.
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
    manifest: {
      files: {
        'onnx/model.onnx': '369ebf04fce8206c83b8fd62e9dc860144f10351a7f885ed3076beb17b7c6dda',
        [TOKENIZER_FILE]: '5124ef2ead1a10a717703bc436de7f353da76d6340e4587719b42b1693707964',
        [TOKENIZER_CONFIG_FILE]: 'f3eecd07c370ef0bf7dd3780d3cd68cf9c8b00c267e21a208ddcd8f82bfec1a6',
        [MODEL_CONFIG_FILE]: '897e756eb59d3183adb505952e7910e7cbc7750a43f3b3747a96b688d2b02a47',
      },
    },
    sha256: '113fb4c7eca1a1ec5f2ace1330fadde2828de68f3f661b4638cc3111b62a3d26',
    licence: 'Apache-2.0',
  }),
  embedder: EmbedderPin.parse({
    role: 'embedder',
    backend: 'onnxruntime',
    model: 'BAAI/bge-small-en-v1.5',
    artefact: { repository: 'BAAI/bge-small-en-v1.5', file: 'onnx/model.onnx' },
    manifest: {
      files: {
        'onnx/model.onnx': '828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35',
        [TOKENIZER_FILE]: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66',
        [TOKENIZER_CONFIG_FILE]: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
        [MODEL_CONFIG_FILE]: '094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750',
      },
      pooling: 'cls',
    },
    sha256: 'cea12e6bda1790cb1e973d4edffa472f9cadac590b0e65c54e9d7d868835aa00',
    licence: 'MIT',
  }),
} as const;

/**
 * The generator's context length in tokens, served by every backend: developer mode's `num_ctx` and the
 * installed app's (#7). Qwen3-4B's native length per its model card, until #7 sizes it under
 * `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A3. Carriers: `.claude/ledgers/generator-context-length.ledger`.
 */
export const PROVISIONAL_GENERATOR_CONTEXT_LENGTH = 32768;
