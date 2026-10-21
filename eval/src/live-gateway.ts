import {
  type EncoderLoad,
  type EncoderLoadFailure,
  type GatewayConfig,
  type GeneratorLoadFailure,
  loadOnnxEmbedder,
  loadOnnxReranker,
  loadOnnxVerifier,
  loadOpenAiHttpGenerator,
  type Reranker,
} from '@cram/gateway';
import type { RecordableGateway } from './recording-gateway';

export type LiveGatewayOpen =
  | { readonly status: 'open'; readonly gateway: RecordableGateway }
  | GeneratorLoadFailure
  | EncoderLoadFailure;

type RerankerLoad = EncoderLoad<Reranker | null>;

const loadReranker = async (config: GatewayConfig): Promise<RerankerLoad> =>
  config.reranker === undefined
    ? { status: 'loaded', encoder: null }
    : loadOnnxReranker(config.reranker);

/** The real backends `config` names; the first role that does not load is the result. */
export const openLiveGateway = async (config: GatewayConfig): Promise<LiveGatewayOpen> => {
  const generator = await loadOpenAiHttpGenerator(config.generator);
  if (generator.status === 'load-failed') return generator;
  const verifier = await loadOnnxVerifier(config.verifier);
  if (verifier.status === 'load-failed') return verifier;
  const embedder = await loadOnnxEmbedder(config.embedder);
  if (embedder.status === 'load-failed') return embedder;
  const reranker = await loadReranker(config);
  if (reranker.status === 'load-failed') return reranker;
  return {
    status: 'open',
    gateway: {
      generator: generator.generator,
      verifier: verifier.encoder,
      embedder: embedder.encoder,
      reranker: reranker.encoder,
    },
  };
};
