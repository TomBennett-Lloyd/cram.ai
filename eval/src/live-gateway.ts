import {
  type EncoderLoadFailure,
  type GatewayConfig,
  loadOnnxEmbedder,
  loadOnnxReranker,
  loadOnnxVerifier,
  OpenAiHttpGenerator,
  type Reranker,
} from '@cram/gateway';
import type { RecordableGateway } from './recording-gateway';

export type LiveGatewayOpen =
  { readonly status: 'open'; readonly gateway: RecordableGateway } | EncoderLoadFailure;

type RerankerLoad =
  { readonly status: 'loaded'; readonly encoder: Reranker | null } | EncoderLoadFailure;

const loadReranker = async (config: GatewayConfig): Promise<RerankerLoad> =>
  config.reranker === undefined
    ? { status: 'loaded', encoder: null }
    : loadOnnxReranker(config.reranker);

/** The real backends `config` names; the first encoder that does not load is the result. */
export const openLiveGateway = async (config: GatewayConfig): Promise<LiveGatewayOpen> => {
  const verifier = await loadOnnxVerifier(config.verifier);
  if (verifier.status === 'load-failed') return verifier;
  const embedder = await loadOnnxEmbedder(config.embedder);
  if (embedder.status === 'load-failed') return embedder;
  const reranker = await loadReranker(config);
  if (reranker.status === 'load-failed') return reranker;
  return {
    status: 'open',
    gateway: {
      generator: new OpenAiHttpGenerator(config.generator),
      verifier: verifier.encoder,
      embedder: embedder.encoder,
      reranker: reranker.encoder,
    },
  };
};
