import {
  ChunkNo,
  chunkLines,
  type SlideChunk,
  type SlideRecord,
  wholeSlideChunk,
} from '@cram/shared';
import type { EmbedderIdentity } from './embedder-identity';

export interface IndexedChunk {
  readonly chunk: SlideChunk;
  readonly embedding: Float32Array | undefined;
}

/** A slide and its chunks (`docs/adr/0008-slide-chunking.md` § Decision (a), (b)); one whole chunk with no vector is #338's words-only slide. */
export interface IndexedSlide {
  readonly record: SlideRecord;
  readonly chunks: readonly [IndexedChunk, ...IndexedChunk[]];
}

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

/** Refuses chunks misnumbered, mistitled, partly without vectors, or not exactly their slide's lines in order (`docs/adr/0008-slide-chunking.md` § Context). */
export const requireSlideChunks = (
  operation: string,
  record: SlideRecord,
  chunks: readonly IndexedChunk[],
  embedder: EmbedderIdentity,
): void => {
  chunks.forEach(({ chunk, embedding }, index) => {
    const at = `${operation}(${record.lectureId}/${String(record.slideNo)} chunk ${String(chunk.chunkNo)})`;
    if (chunk.chunkNo !== index + 1)
      throw new Error(`${at}: chunks must be numbered 1..n in order`);
    if (chunk.title !== record.title) throw new Error(`${at}: the title is not its slide's`);
    if (embedding === undefined && chunks.length > 1)
      throw new Error(`${at}: a split slide's every chunk needs a vector`);
    if (embedding !== undefined) requireDimension(at, embedding, embedder);
  });
  const held = chunks.flatMap(({ chunk }) => chunkLines(chunk).map(lineKey));
  const lines = chunkLines(record).map(lineKey);
  if (held.length !== lines.length || held.some((line, index) => line !== lines[index]))
    throw new Error(
      `${operation}(${record.lectureId}/${String(record.slideNo)}): its chunks do not hold exactly its slide's lines in order`,
    );
};
