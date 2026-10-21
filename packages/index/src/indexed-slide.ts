import {
  ChunkNo,
  chunkLines,
  type SlideChunk,
  type SlideRecord,
  wholeSlideChunk,
} from '@cram/shared';
import type { EmbedderIdentity } from './embedder-identity';

/** One chunk and its vector; `undefined` is a chunk found by its words only. */
export interface IndexedChunk {
  readonly chunk: SlideChunk;
  readonly embedding: Float32Array | undefined;
}

/**
 * A slide and the chunks it is indexed as (`docs/adr/0008-slide-chunking.md` § Decision (a), (b)).
 * One whole-slide chunk with no vector stores the slide for listing, citation and BM25 outside the
 * vector list: a slide the embedder does not take is never truncated (#338).
 */
export interface IndexedSlide {
  readonly record: SlideRecord;
  readonly chunks: readonly [IndexedChunk, ...IndexedChunk[]];
}

/** The slide as one chunk, with `embedding` as its vector. */
export const wholeSlide = (
  record: SlideRecord,
  embedding: Float32Array | undefined,
): IndexedSlide => ({
  record,
  chunks: [{ chunk: { chunkNo: ChunkNo.parse(1), ...wholeSlideChunk(record) }, embedding }],
});

export const requireDimension = (
  operation: string,
  embedding: Float32Array,
  embedder: EmbedderIdentity,
): void => {
  if (embedding.length !== embedder.dimension) {
    throw new Error(
      `${operation}: embedding has ${String(embedding.length)} dimensions; ${embedder.model} has ${String(embedder.dimension)}`,
    );
  }
};

const lineKey = ({ field, text }: { field: string; text: string }): string => `${field}\n${text}`;

/**
 * Refuses chunks that are not numbered 1..n in order, that hold a line or a title their slide does
 * not, or that leave a split slide partly outside the vector list.
 */
export const requireSlideChunks = (
  operation: string,
  record: SlideRecord,
  chunks: readonly IndexedChunk[],
  embedder: EmbedderIdentity,
): void => {
  const lines = new Set(chunkLines(record).map(lineKey));
  chunks.forEach(({ chunk, embedding }, index) => {
    const at = `${operation}(${record.lectureId}/${String(record.slideNo)} chunk ${String(chunk.chunkNo)})`;
    if (chunk.chunkNo !== index + 1)
      throw new Error(`${at}: chunks must be numbered 1..n in order`);
    if (chunk.title !== record.title) throw new Error(`${at}: the title is not its slide's`);
    const foreign = chunkLines(chunk).find((line) => !lines.has(lineKey(line)));
    if (foreign !== undefined) throw new Error(`${at}: holds a line its slide does not`);
    if (embedding === undefined && chunks.length > 1)
      throw new Error(`${at}: a split slide's every chunk needs a vector`);
    if (embedding !== undefined) requireDimension(at, embedding, embedder);
  });
};
