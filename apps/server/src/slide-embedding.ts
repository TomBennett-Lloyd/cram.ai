import type { Embedder } from '@cram/gateway';
import { slideText } from '@cram/grounding';
import { EmbedderIdentity, type IndexedSlide } from '@cram/index';
import type { SlideRecord } from '@cram/shared';

export const PROBE_TEXT = 'embedder probe';

const vectorsFor = async (
  embedder: Embedder,
  texts: readonly string[],
): Promise<readonly Float32Array[]> => {
  const vectors = await embedder.embed({ texts: [...texts] });
  if (vectors.length !== texts.length) {
    throw new Error(
      `embedder ${embedder.pin.model} returned ${String(vectors.length)} vectors for ${String(texts.length)} texts`,
    );
  }
  return vectors;
};

/** The pin's (model, sha256) and the dimension its artefact produces (`docs/adr/0003-model-roles-and-backends.md` § Decision (e)). */
export const embedderIdentity = async (embedder: Embedder): Promise<EmbedderIdentity> => {
  const [probe] = await vectorsFor(embedder, [PROBE_TEXT]);
  return EmbedderIdentity.parse({
    model: `${embedder.pin.model}@${embedder.pin.sha256}`,
    dimension: probe?.length,
  });
};

export const embedSlides = async (
  embedder: Embedder,
  records: readonly SlideRecord[],
): Promise<readonly IndexedSlide[]> => {
  const vectors = await vectorsFor(embedder, records.map(slideText));
  return records.flatMap((record, index) => {
    const embedding = vectors[index];
    return embedding === undefined ? [] : [{ record, embedding }];
  });
};

export const embedQuestion = async (
  embedder: Embedder,
  question: string,
): Promise<Float32Array> => {
  const [vector] = await vectorsFor(embedder, [question]);
  if (vector === undefined) throw new Error('embedQuestion: no vector for the question');
  return vector;
};
