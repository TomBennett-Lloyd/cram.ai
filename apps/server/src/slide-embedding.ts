import type { Embedder, EmbeddingResult } from '@cram/gateway';
import { EmbedderIdentity, embedSlideChunks, type IndexedSlide, wholeSlide } from '@cram/index';
import type { SlideRecord } from '@cram/shared';

export const PROBE_TEXT = 'embedder probe';

const resultsFor = async (
  embedder: Embedder,
  texts: readonly string[],
): Promise<readonly EmbeddingResult[]> => {
  const results = await embedder.embed({ texts: [...texts] });
  if (results.length !== texts.length) {
    throw new Error(
      `embedder ${embedder.pin.model} returned ${String(results.length)} results for ${String(texts.length)} texts`,
    );
  }
  return results;
};

/** The pin's (model, sha256) and the dimension its artefact produces (`docs/adr/0003-model-roles-and-backends.md` § Decision (e)). */
export const embedderIdentity = async (embedder: Embedder): Promise<EmbedderIdentity> => {
  const [probe] = await resultsFor(embedder, [PROBE_TEXT]);
  if (probe?.status !== 'embedded')
    throw new Error(`embedder ${embedder.pin.model} did not embed its probe`);
  return EmbedderIdentity.parse({
    model: `${embedder.pin.model}@${embedder.pin.sha256}`,
    dimension: probe.vector.length,
  });
};

/**
 * Every record indexed as its chunks (`embedSlideChunks`), never truncated: a `references` slide
 * is not sent to the embedder and keeps no vector (#338); `docs/adr/0008-slide-chunking.md` § Decision (c)–(e).
 */
export const embedSlides = async (
  embedder: Embedder,
  records: readonly SlideRecord[],
): Promise<readonly IndexedSlide[]> => {
  const embeddable = records.filter(({ kind }) => kind !== 'references');
  const chunked = await embedSlideChunks((texts) => resultsFor(embedder, texts), embeddable);
  const bySlide = new Map(embeddable.map((record, index) => [record, chunked[index]]));
  return records.map((record) => bySlide.get(record) ?? wholeSlide(record, undefined));
};

export const embedQuestion = async (
  embedder: Embedder,
  question: string,
): Promise<EmbeddingResult> => {
  const [result] = await resultsFor(embedder, [question]);
  if (result === undefined) throw new Error('embedQuestion: no result for the question');
  return result;
};
