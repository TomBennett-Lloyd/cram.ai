import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import { ftsMatchExpression } from './fts-query';

const RowIds = z.array(z.number().int());

/** BM25's chunks for the query's words, best first; none when it has no word. */
export const wordList = (
  db: Database,
  text: string,
  filter: string,
  depth: number,
): readonly number[] => {
  const match = ftsMatchExpression(text);
  if (match === undefined) return [];
  return RowIds.parse(
    db
      .prepare(
        `select rowid from slides_fts where slides_fts match ? ${filter} order by rank limit ?`,
      )
      .pluck()
      .all(match, depth),
  );
};

export const vectorList = (
  db: Database,
  embedding: Float32Array,
  filter: string,
  depth: number,
): readonly number[] =>
  RowIds.parse(
    db
      .prepare(
        `select rowid from slide_vec where embedding match ? and k = ? ${filter} order by distance`,
      )
      .pluck()
      .all(embedding, depth),
  );

export const firstPerSlide = (
  chunkIds: readonly number[],
  slideOf: (chunkId: number) => number,
): readonly number[] => [...new Set(chunkIds.map(slideOf))];
