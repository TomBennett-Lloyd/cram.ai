import type { Embedder, EmbeddingResult, OverLength } from '@cram/gateway';
import { slideText } from '@cram/grounding';
import { EmbedderIdentity, type IndexedSlide } from '@cram/index';
import type { SlideNo, SlideRecord } from '@cram/shared';

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

/** Every slide embedded, or the slides longer than the embedder takes: never truncated (`docs/adr/0003-model-roles-and-backends.md` § Decision (d)). */
export type SlideEmbedding =
  | { readonly status: 'embedded'; readonly slides: readonly IndexedSlide[] }
  | {
      readonly status: 'over-length';
      readonly slideNos: readonly SlideNo[];
      readonly maxInputTokens: number;
    };

export const embedSlides = async (
  embedder: Embedder,
  records: readonly SlideRecord[],
): Promise<SlideEmbedding> => {
  const results = await resultsFor(embedder, records.map(slideText));
  const slides: IndexedSlide[] = [];
  const overLength: { readonly slideNo: SlideNo; readonly result: OverLength }[] = [];
  records.forEach((record, index) => {
    const result = results[index];
    if (result?.status === 'embedded') slides.push({ record, embedding: result.vector });
    else if (result !== undefined) overLength.push({ slideNo: record.slideNo, result });
  });
  const [first] = overLength;
  return first === undefined
    ? { status: 'embedded', slides }
    : {
        status: 'over-length',
        slideNos: overLength.map(({ slideNo }) => slideNo),
        maxInputTokens: first.result.maxInputTokens,
      };
};

export const embedQuestion = async (
  embedder: Embedder,
  question: string,
): Promise<EmbeddingResult> => {
  const [result] = await resultsFor(embedder, [question]);
  if (result === undefined) throw new Error('embedQuestion: no result for the question');
  return result;
};
