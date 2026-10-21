import type { Embedder, EmbeddingResult } from '@cram/gateway';
import { EmbedderIdentity, type IndexedSlide } from '@cram/index';
import { embedText, type SlideRecord } from '@cram/shared';

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
 * Every record, with a vector unless the embedder cannot take it whole, which is never truncated
 * (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)), or it is a `references` slide (#338).
 */
export const embedSlides = async (
  embedder: Embedder,
  records: readonly SlideRecord[],
): Promise<readonly IndexedSlide[]> => {
  const embeddable = records.filter(({ kind }) => kind !== 'references');
  const results = await resultsFor(embedder, embeddable.map(embedText));
  const vectors = new Map(
    embeddable.map((record, index) => {
      const result = results[index];
      return [record, result?.status === 'embedded' ? result.vector : undefined] as const;
    }),
  );
  return records.map((record) => ({ record, embedding: vectors.get(record) }));
};

export const embedQuestion = async (
  embedder: Embedder,
  question: string,
): Promise<EmbeddingResult> => {
  const [result] = await resultsFor(embedder, [question]);
  if (result === undefined) throw new Error('embedQuestion: no result for the question');
  return result;
};
