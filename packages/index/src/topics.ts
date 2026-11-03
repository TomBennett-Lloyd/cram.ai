import type { Database } from 'better-sqlite3';
import {
  ChunkNo,
  type SlideChunk,
  slideFields,
  type SourceId,
  TopicOrigin,
  TopicTag,
} from '@cram/shared';
import { z } from 'zod';
import { INDEX_WORDS } from './index-words';

/** A fact is one chunk of a slide (`docs/adr/0008-slide-chunking.md`), the row every ranked list reads. */
export interface FactRef {
  readonly sourceId: SourceId;
  readonly chunkNo: ChunkNo;
}

export interface TagRow {
  readonly chunkNo: ChunkNo;
  readonly origin: TopicOrigin;
  readonly tag: TopicTag;
}

const termsOf = (text: string): readonly string[] =>
  INDEX_WORDS.words(text).map(({ term }) => term);

const occursIn = (needle: readonly string[], haystack: readonly string[]): boolean =>
  needle.length > 0 &&
  haystack.some((_, start) => needle.every((term, offset) => haystack[start + offset] === term));

/** The tags a query names: each whose terms occur in the query's, in order and adjacent. */
export const namedTags = (query: string, tags: readonly TopicTag[]): readonly TopicTag[] => {
  const queryTerms = termsOf(query);
  return tags.filter((tag) => occursIn(termsOf(tag), queryTerms));
};

export interface TopicMember {
  readonly chunkId: number;
  readonly named: number;
}

const byVectorRank = (a: number | undefined, b: number | undefined): number => {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  return a - b;
};

/** Most named tags, then vector-list rank, unranked last, then id; ranks stand in for distance (`search-plan.test.ts`). */
export const rankTopicMembers = (
  members: readonly TopicMember[],
  vectorRankOf: ReadonlyMap<number, number>,
): readonly number[] =>
  [...members]
    .sort(
      (a, b) =>
        b.named - a.named ||
        byVectorRank(vectorRankOf.get(a.chunkId), vectorRankOf.get(b.chunkId)) ||
        a.chunkId - b.chunkId,
    )
    .map(({ chunkId }) => chunkId);

const chunkKey = (chunk: SlideChunk): string => JSON.stringify([chunk.chunkNo, slideFields(chunk)]);

const sameChunks = (old: readonly SlideChunk[], next: readonly SlideChunk[]): boolean =>
  old.length === next.length &&
  old.every((chunk, index) => {
    const other = next[index];
    return other !== undefined && chunkKey(chunk) === chunkKey(other);
  });

/** A slide's tags onto its re-cut chunks: by number if the chunks are unchanged, else all onto each, so none is lost. */
export const carriedTags = (
  old: readonly SlideChunk[],
  rows: readonly TagRow[],
  next: readonly SlideChunk[],
): readonly TagRow[] => {
  if (sameChunks(old, next)) return rows;
  const distinct = [
    ...new Map(rows.map((row) => [JSON.stringify([row.origin, row.tag]), row])).values(),
  ];
  return next.flatMap(({ chunkNo }) => distinct.map((row) => ({ ...row, chunkNo })));
};

const StoredTagRow = z.object({
  chunk_no: z.number(),
  origin: TopicOrigin,
  tag: z.string(),
});

export const slideTagRows = (db: Database, sourceId: SourceId): readonly TagRow[] =>
  z
    .array(StoredTagRow)
    .parse(
      db
        .prepare(
          `select chunks.chunk_no, topics.origin, topics.tag from topics join chunks on chunks.id = topics.chunk_id
            where chunks.slide_id = (select id from slides where source_id = ?) order by chunks.chunk_no, topics.origin, topics.tag`,
        )
        .all(sourceId),
    )
    .map((row) => ({
      chunkNo: ChunkNo.parse(row.chunk_no),
      origin: row.origin,
      tag: TopicTag.parse(row.tag),
    }));

export type SetTopicsResult = { readonly status: 'set' } | { readonly status: 'no-such-fact' };

const factChunkId = (db: Database, fact: FactRef): number | undefined =>
  z
    .number()
    .int()
    .optional()
    .parse(
      db
        .prepare(
          'select id from chunks where slide_id = (select id from slides where source_id = ?) and chunk_no = ?',
        )
        .pluck()
        .get(fact.sourceId, fact.chunkNo),
    );

/** Replaces the fact's tags of one origin; the caller holds the transaction. */
export const setFactTopics = (
  db: Database,
  fact: FactRef,
  origin: TopicOrigin,
  tags: readonly TopicTag[],
): SetTopicsResult => {
  const chunkId = factChunkId(db, fact);
  if (chunkId === undefined) return { status: 'no-such-fact' };
  db.prepare('delete from topics where chunk_id = ? and origin = ?').run(chunkId, origin);
  const insert = db.prepare(
    'insert or ignore into topics (chunk_id, origin, tag) values (?, ?, ?)',
  );
  for (const tag of tags) insert.run(chunkId, origin, tag);
  return { status: 'set' };
};

/** The fact holds exactly `tags`: a held tag keeps its origin, a new one is the student's; the caller holds the transaction. */
export const editFactTopics = (
  db: Database,
  fact: FactRef,
  tags: readonly TopicTag[],
): SetTopicsResult => {
  const chunkId = factChunkId(db, fact);
  if (chunkId === undefined) return { status: 'no-such-fact' };
  const wanted = new Set<string>(tags);
  const held = new Set(
    z
      .array(z.string())
      .parse(db.prepare('select distinct tag from topics where chunk_id = ?').pluck().all(chunkId)),
  );
  const drop = db.prepare('delete from topics where chunk_id = ? and tag = ?');
  for (const tag of held) if (!wanted.has(tag)) drop.run(chunkId, tag);
  const insert = db.prepare('insert into topics (chunk_id, origin, tag) values (?, ?, ?)');
  for (const tag of wanted) if (!held.has(tag)) insert.run(chunkId, TopicOrigin.enum.student, tag);
  return { status: 'set' };
};

export const dropSlideTopics = (db: Database, slideId: number): void => {
  db.prepare('delete from topics where chunk_id in (select id from chunks where slide_id = ?)').run(
    slideId,
  );
};

const TaggedChunks = z.array(z.object({ chunkId: z.number().int(), tag: z.string() }));

/** Topic membership as a best-first list of chunk ids (`docs/adr/0009-explanation-answers.md` § Decision (n)). */
export const topicList = (
  db: Database,
  text: string,
  filter: string,
  nearest: readonly number[],
  depth: number,
): readonly number[] => {
  const stored = z
    .array(TopicTag)
    .parse(db.prepare('select distinct tag from topics').pluck().all());
  const tags = namedTags(text, stored);
  const marks = tags.map(() => '?').join(', ');
  const namedBy = new Map<number, Set<string>>();
  for (const { chunkId, tag } of TaggedChunks.parse(
    db
      .prepare(`select chunk_id as chunkId, tag from topics where tag in (${marks}) ${filter}`)
      .all(...tags),
  )) {
    const named = namedBy.get(chunkId) ?? new Set<string>();
    named.add(termsOf(tag).join(' '));
    namedBy.set(chunkId, named);
  }
  const members = [...namedBy].map(([chunkId, named]) => ({ chunkId, named: named.size }));
  const vectorRankOf = new Map(nearest.map((chunkId, rank) => [chunkId, rank]));
  return rankTopicMembers(members, vectorRankOf).slice(0, depth);
};

/** Writes carried rows onto the slide's chunks by number; the caller holds the transaction. */
export const insertTagRows = (db: Database, slideId: number, rows: readonly TagRow[]): void => {
  const insert = db.prepare(
    `insert or ignore into topics (chunk_id, origin, tag)
      values ((select id from chunks where slide_id = ? and chunk_no = ?), ?, ?)`,
  );
  for (const { chunkNo, origin, tag } of rows) insert.run(slideId, chunkNo, origin, tag);
};
