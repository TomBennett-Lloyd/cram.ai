import Database from 'better-sqlite3';
import { ChunkNo, type SlideChunk, TopicTag } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { carriedTags, namedTags, rankTopicMembers, type TagRow } from './topics';

const tag = (text: string): TopicTag => TopicTag.parse(text);

/** The oracle: FTS5's unicode61 tokenizer, asked whether the query matches the tag as a phrase. */
const ftsNames = (query: string, text: string): boolean => {
  const db = new Database(':memory:');
  try {
    db.exec('create virtual table q using fts5(t, tokenize = "unicode61 remove_diacritics 0")');
    db.prepare('insert into q (t) values (?)').run(query);
    const phrase = `"${text.replaceAll('"', '""')}"`;
    return db.prepare('select count(*) from q where q match ?').pluck().get(phrase) === 1;
  } finally {
    db.close();
  }
};

// [query, tag]: the tag's position in the query, its case, its separators, word order, adjacency, inflection,
// scripts and a tag with no terms.
const CORPUS: readonly (readonly [string, string])[] = [
  ['diabetes', 'diabetes'],
  ['What does the course say about diabetes?', 'diabetes'],
  ['DIABETES and its drugs', 'diabetes'],
  ['how is diabetes treated', 'Diabetes'],
  ['', 'diabetes'],
  ['type-2 diabetes', 'type 2 diabetes'],
  ['what causes type 2 diabetes in adults', 'type 2 diabetes'],
  ['diabetes type 2', 'type 2 diabetes'],
  ['type 2 and diabetes', 'type 2 diabetes'],
  ['type 2', 'type 2 diabetes'],
  ['type type 2 diabetes', 'type 2 diabetes'],
  ['cells', 'cell'],
  ['cellular respiration', 'cell'],
  ['the cell wall', 'cell'],
  ['what is the ph of blood', 'pH'],
  ['the na k pump', 'Na+/K+ pump'],
  ['what about +++ here', '+++'],
  ['cafe culture', 'café'],
  ['CAFÉ', 'Café'],
  ['Β blockers and the heart', 'β-blockers'],
  ['cell biology', 'cell\nbiology'],
  ['snake case', 'snake_case'],
  ['alzheimer s disease', "Alzheimer's"],
  ['糖尿病について', '糖尿病'],
  ['糖尿病 と 薬', '糖尿病'],
  ['a b', 'b'],
  ['b a', 'b'],
  ['Istanbul', 'İstanbul'],
  ['naïve bayes', 'naïve bayes'],
];

describe('namedTags', () => {
  it('names a tag exactly when FTS5 matches it as a phrase in the query', () => {
    for (const [query, text] of CORPUS)
      expect(namedTags(query, [tag(text)]).length === 1, `${query} / ${text}`).toBe(
        ftsNames(query, text),
      );
  });

  it('names a topic wherever it sits in the question, in any case', () => {
    expect(namedTags('Diabetes: how is it treated', [tag('diabetes')])).toEqual(['diabetes']);
    expect(namedTags('how is DIABETES treated', [tag('diabetes')])).toEqual(['diabetes']);
    expect(namedTags('what treats diabetes', [tag('Diabetes')])).toEqual(['Diabetes']);
  });

  it('names a several-word tag only as adjacent words in its own order', () => {
    const tags = [tag('drug interactions')];
    expect(namedTags('which drug interactions matter', tags)).toEqual(tags);
    expect(namedTags('interactions of a drug', tags)).toEqual([]);
    expect(namedTags('drug and food interactions', tags)).toEqual([]);
    expect(namedTags('drug drug interactions', tags)).toEqual(tags);
  });

  it('never names a tag with no terms, nor a part of a word', () => {
    expect(namedTags('what about +++ here', [tag('+++')])).toEqual([]);
    expect(namedTags('cellular respiration', [tag('cell')])).toEqual([]);
  });

  it('keeps every named tag, in the order given', () => {
    const tags = [tag('insulin'), tag('kidney'), tag('diabetes')];
    expect(namedTags('diabetes and insulin', tags)).toEqual(['insulin', 'diabetes']);
  });
});

describe('rankTopicMembers', () => {
  it('ranks more named tags first, then higher in the vector list, then a chunk it missed, then by id', () => {
    const members = [
      { chunkId: 5, named: 1 },
      { chunkId: 4, named: 1 },
      { chunkId: 3, named: 1 },
      { chunkId: 2, named: 1 },
      { chunkId: 1, named: 2 },
    ];
    const vectorRankOf = new Map([
      [1, 9],
      [2, 5],
      [3, 1],
    ]);
    expect(rankTopicMembers(members, vectorRankOf)).toEqual([1, 3, 2, 4, 5]);
  });

  it('keeps the higher vector rank ahead whichever order the members arrive in', () => {
    const vectorRankOf = new Map([
      [7, 2],
      [8, 1],
    ]);
    const members = [
      { chunkId: 7, named: 1 },
      { chunkId: 8, named: 1 },
    ];
    expect(rankTopicMembers(members, vectorRankOf)).toEqual([8, 7]);
    expect(rankTopicMembers([...members].reverse(), vectorRankOf)).toEqual([8, 7]);
  });

  it('puts a chunk the vector list missed after one it reached, from either side of the comparison', () => {
    const vectorRankOf = new Map([[2, 9]]);
    expect(
      rankTopicMembers(
        [
          { chunkId: 1, named: 1 },
          { chunkId: 2, named: 1 },
        ],
        vectorRankOf,
      ),
    ).toEqual([2, 1]);
    expect(
      rankTopicMembers(
        [
          { chunkId: 2, named: 1 },
          { chunkId: 1, named: 1 },
        ],
        vectorRankOf,
      ),
    ).toEqual([2, 1]);
  });
});

const chunk = (chunkNo: number, body: string, overrides: Partial<SlideChunk> = {}): SlideChunk => ({
  chunkNo: ChunkNo.parse(chunkNo),
  title: 'T',
  body,
  speakerNotes: '',
  imageCaptions: [],
  ...overrides,
});
const row = (chunkNo: number, origin: TagRow['origin'], text: string): TagRow => ({
  chunkNo: ChunkNo.parse(chunkNo),
  origin,
  tag: tag(text),
});

describe('carriedTags', () => {
  const old = [chunk(1, 'a'), chunk(2, 'b')];
  const rows = [row(1, 'tagger', 'diabetes'), row(2, 'student', 'kidney')];

  it('keeps each tag on its own chunk when the slide is cut the same way', () => {
    expect(carriedTags(old, rows, [chunk(1, 'a'), chunk(2, 'b')])).toEqual(rows);
  });

  it('puts every tag of the slide on every chunk once any chunk differs', () => {
    const recut = [
      [chunk(1, 'a\nb')],
      [chunk(1, 'a'), chunk(2, 'b'), chunk(3, 'c')],
      [chunk(1, 'a'), chunk(2, 'b', { title: 'U' })],
      [chunk(1, 'a'), chunk(2, 'b', { speakerNotes: 'n' })],
      [chunk(1, 'a'), chunk(2, 'b', { imageCaptions: ['c'] })],
      [chunk(1, 'a'), chunk(3, 'b')],
      [chunk(1, 'a'), chunk(2, 'B')],
    ];
    for (const next of recut)
      expect(carriedTags(old, rows, next), JSON.stringify(next)).toEqual(
        next.flatMap(({ chunkNo }) => [
          row(chunkNo, 'tagger', 'diabetes'),
          row(chunkNo, 'student', 'kidney'),
        ]),
      );
  });

  it('carries a tag two chunks shared once per new chunk, and keeps its origin apart from the other', () => {
    const shared = [
      row(1, 'tagger', 'diabetes'),
      row(2, 'tagger', 'diabetes'),
      row(2, 'student', 'diabetes'),
    ];
    expect(carriedTags(old, shared, [chunk(1, 'a b')])).toEqual([
      row(1, 'tagger', 'diabetes'),
      row(1, 'student', 'diabetes'),
    ]);
  });
});
