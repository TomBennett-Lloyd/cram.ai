import {
  ChunkNo,
  embedText,
  type OverLengthMeasure,
  type QuotableFields,
  type SlideRecord,
  splitChunk,
  wholeSlideChunk,
} from '@cram/shared';
import { type IndexedChunk, type IndexedSlide, wholeSlide } from './indexed-slide';

/** What an embedder returns per text; the gateway's `EmbeddingResult` has this shape. */
export type EmbedTextResult =
  | { readonly status: 'embedded'; readonly vector: Float32Array }
  | ({ readonly status: 'over-length' } & OverLengthMeasure);

export type EmbedTexts = (texts: readonly string[]) => Promise<readonly EmbedTextResult[]>;

interface Piece {
  readonly fields: QuotableFields;
  readonly vector?: Float32Array;
}

const resultsFor = async (
  embed: EmbedTexts,
  pieces: readonly Piece[],
): Promise<readonly EmbedTextResult[]> => {
  const results = await embed(pieces.map(({ fields }) => embedText(fields)));
  if (results.length !== pieces.length)
    throw new Error(
      `embedSlideChunks: the embedder returned ${String(results.length)} results for ${String(pieces.length)} texts`,
    );
  return results;
};

const replacedPieces = (
  pieces: readonly Piece[],
  next: ReadonlyMap<Piece, readonly Piece[] | undefined>,
): readonly Piece[] | undefined => {
  const replaced: Piece[] = [];
  for (const piece of pieces) {
    const group = next.has(piece) ? next.get(piece) : [piece];
    if (group === undefined) return undefined;
    replaced.push(...group);
  }
  return replaced;
};

const indexedChunks = (pieces: readonly Piece[]): readonly IndexedChunk[] =>
  pieces.map(({ fields, vector }, index) => ({
    chunk: { chunkNo: ChunkNo.parse(index + 1), ...fields },
    embedding: vector,
  }));

/**
 * Embeds each slide whole, then splits and re-embeds what the embedder reports over-length, one call per round (`docs/adr/0008-slide-chunking.md` § Decision (c)–(e)).
 * Each split leaves every piece fewer lines than its parent, so the rounds end.
 */
export const embedSlideChunks = async (
  embed: EmbedTexts,
  records: readonly SlideRecord[],
): Promise<readonly IndexedSlide[]> => {
  let slides: readonly (readonly Piece[] | undefined)[] = records.map((record) => [
    { fields: wholeSlideChunk(record) },
  ]);
  for (;;) {
    const pending = slides.flatMap((pieces) =>
      (pieces ?? []).filter(({ vector }) => vector === undefined),
    );
    if (pending.length === 0) break;
    const results = await resultsFor(embed, pending);
    const next = new Map<Piece, readonly Piece[] | undefined>();
    pending.forEach((piece, index) => {
      const result = results[index];
      if (result?.status === 'embedded') next.set(piece, [{ ...piece, vector: result.vector }]);
      else if (result !== undefined) {
        const split = splitChunk(piece.fields, result);
        next.set(
          piece,
          split.status === 'split' ? split.pieces.map((fields) => ({ fields })) : undefined,
        );
      }
    });
    slides = slides.map((pieces) => pieces && replacedPieces(pieces, next));
  }
  return records.map((record, index) => {
    const [first, ...rest] = indexedChunks(slides[index] ?? []);
    return first === undefined
      ? wholeSlide(record, undefined)
      : { record, chunks: [first, ...rest] };
  });
};
