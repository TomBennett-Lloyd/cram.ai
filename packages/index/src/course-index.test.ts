import { ChunkNo, SourceId, TopicTag } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunked,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
  firstFact,
} from './course-fixture';
import { CANDIDATES_PER_LIST, RETRIEVAL_K, type CourseIndex } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import { sourceIdOf } from './slide-row';

let temp: TempCourse;
let course: CourseIndex;
beforeEach(() => {
  temp = tempCourse();
  course = openOrFail(temp.spec);
});
afterEach(() => {
  course.close();
  temp.remove();
});

const AWAY = vector(0, 0, 0, 1);
const bodies = (text: string, embedding: Float32Array, k?: number) =>
  (k === undefined
    ? course.search({ text, embedding })
    : course.search({ text, embedding }, k)
  ).map((hit) => hit.record.body);

describe('CourseIndex.search', () => {
  const LECTURE_1 = [
    indexed(
      slide({ slideNo: 1, body: 'osmosis moves water across a membrane' }),
      vector(1, 0, 0, 0),
    ),
    indexed(slide({ slideNo: 2, body: 'diffusion spreads solutes' }), vector(0, 1, 0, 0)),
    indexed(slide({ slideNo: 3, body: 'the krebs cycle' }), vector(0, 0, 1, 0)),
  ];
  beforeEach(() => {
    indexLectures(course, LECTURE_1);
  });

  it('finds a slide by its words when its vector points elsewhere', () => {
    expect(bodies('krebs', AWAY, 1)).toEqual(['the krebs cycle']);
  });

  it('finds a slide by its vector when it shares no word with the question', () => {
    expect(bodies('', vector(0, 1, 0, 0), 1)).toEqual(['diffusion spreads solutes']);
    expect(bodies('unrelated words', vector(0, 1, 0, 0), 1)).toEqual(['diffusion spreads solutes']);
  });

  it('ranks a slide both lists found above slides only one list found', () => {
    expect(bodies('krebs osmosis', vector(1, 0.1, 0, 0), 1)).toEqual([
      'osmosis moves water across a membrane',
    ]);
  });

  it('returns each slide once, best first, with its source id', () => {
    const hits = course.search({ text: 'osmosis', embedding: vector(1, 0, 0, 0) });
    expect(new Set(hits.map((hit) => hit.sourceId)).size).toBe(3);
    expect(hits[0]?.sourceId).toBe(sourceIdOf(slide({ slideNo: 1 })));
  });

  it('refuses a k that is not a positive integer, and a query vector of the wrong dimension', () => {
    expect(() => course.search({ text: 'x', embedding: AWAY }, 0)).toThrow(/positive integer/);
    expect(() => course.search({ text: 'x', embedding: AWAY }, 1.5)).toThrow(/positive integer/);
    expect(() => course.search({ text: 'x', embedding: vector(1, 0) }, 1)).toThrow(/2 dimensions/);
  });

  it('searches speaker notes, image captions and the lecture title as well as the body', () => {
    indexLectures(course, [
      ...LECTURE_1,
      indexed(slide({ slideNo: 4, body: 'notes slide', speakerNotes: 'mitochondria' }), AWAY),
      indexed(slide({ slideNo: 5, body: 'caption slide', imageCaptions: ['a chloroplast'] }), AWAY),
      indexed(
        slide({ lectureId: 'lecture-2', lectureTitle: 'Photosynthesis', body: 'title slide' }),
        AWAY,
      ),
    ]);
    // The vector favours 'the krebs cycle', so each hit below is the word match's doing.
    const krebs = vector(0, 0, 1, 0);
    expect(bodies('mitochondria', krebs, 1)).toEqual(['notes slide']);
    expect(bodies('chloroplast', krebs, 1)).toEqual(['caption slide']);
    expect(bodies('photosynthesis', krebs, 1)).toEqual(['title slide']);
  });
});

describe('CourseIndex.search on references slides', () => {
  const REFERENCES = indexed(
    slide({ slideNo: 1, kind: 'references', body: 'osmosis reading list' }),
    vector(1, 0, 0, 0),
  );
  const CONTENT = indexed(slide({ slideNo: 2, body: 'osmosis moves water' }), vector(0, 0, 1, 0));
  const IMAGE_ONLY = indexed(
    slide({ slideNo: 3, kind: 'image-only', title: 'mitochondria' }),
    vector(0, 1, 0, 0),
  );
  beforeEach(() => {
    indexLectures(course, [REFERENCES, CONTENT, IMAGE_ONLY]);
  });

  it('leaves a references slide out of the word list and the vector list by default', () => {
    const others = ['', 'osmosis moves water'];
    expect(bodies('reading list', AWAY, 3).toSorted()).toEqual(others);
    expect(bodies('', vector(1, 0, 0, 0), 3).toSorted()).toEqual(others);
  });

  it('keeps image-only slides searchable by their words and their vector', () => {
    const top = (text: string, embedding: Float32Array) =>
      course.search({ text, embedding }, 1)[0]?.record.kind;
    expect(top('', vector(0, 1, 0, 0))).toBe('image-only');
    expect(top('mitochondria', vector(0, 0, 1, 0))).toBe('image-only');
  });

  it('returns a references slide by its words or its vector when the query includes them', () => {
    const included = (text: string, embedding: Float32Array) =>
      course.search({ text, embedding, includeReferences: true }, 1).map((hit) => hit.record.body);
    expect(included('reading list', AWAY)).toEqual(['osmosis reading list']);
    expect(included('', vector(1, 0, 0, 0))).toEqual(['osmosis reading list']);
  });

  it('leaves references slides out before each list is cut, so they never use up its depth', () => {
    const crowd = Array.from({ length: CANDIDATES_PER_LIST }, (_, index) =>
      indexed(
        slide({ lectureId: 'lecture-2', slideNo: index + 1, kind: 'references', body: 'osmosis' }),
        vector(1, 0, 0, 0),
      ),
    );
    indexLectures(course, crowd);
    expect(bodies('', vector(1, 0, 0, 0), 2).toSorted()).toEqual(['', 'osmosis moves water']);
    // The vector list ranks the image-only slide first, so only the word list can lift content above it.
    expect(bodies('osmosis', vector(0, 1, 0, 0), 1)).toEqual(['osmosis moves water']);
  });
});

describe('CourseIndex.search on k', () => {
  it('returns RETRIEVAL_K slides by default, and never more than the course holds', () => {
    const many = Array.from({ length: RETRIEVAL_K + 2 }, (_, index) =>
      indexed(slide({ slideNo: index + 1, body: `cell ${String(index)}` }), vector(1, index, 0, 0)),
    );
    indexLectures(course, many);
    expect(bodies('cell', AWAY)).toHaveLength(RETRIEVAL_K);
    expect(bodies('cell', AWAY, RETRIEVAL_K + 10)).toHaveLength(RETRIEVAL_K + 2);
  });

  it('returns k slides when k is deeper than CANDIDATES_PER_LIST', () => {
    const deep = CANDIDATES_PER_LIST + 5;
    indexLectures(
      course,
      Array.from({ length: deep }, (_, index) =>
        indexed(slide({ slideNo: index + 1, body: 'cell' }), vector(1, index, 0, 0)),
      ),
    );
    expect(bodies('', AWAY, deep)).toHaveLength(deep);
  });

  it('returns nothing from an empty course', () => {
    expect(bodies('anything', AWAY)).toEqual([]);
  });
});

describe('CourseIndex.slides', () => {
  it('returns records exactly as written', () => {
    const record = slide({
      title: 'T',
      body: 'B',
      speakerNotes: 'N',
      imageCaptions: ['c1', 'c2'],
      derived: true,
      kind: 'references',
    });
    indexLectures(course, [indexed(record, AWAY)]);
    expect(course.slides()).toEqual([record]);
  });
});

describe('CourseIndex topics', () => {
  const first = sourceIdOf(slide({ slideNo: 1 }));
  const second = sourceIdOf(slide({ slideNo: 2 }));
  const tags = (...texts: string[]) => texts.map((text) => TopicTag.parse(text));
  beforeEach(() => {
    indexLectures(course, [
      chunked(slide({ slideNo: 2, body: 'second\nsecond again' }), AWAY, AWAY),
      indexed(slide({ slideNo: 1, body: 'first' }), AWAY),
    ]);
  });

  it('replaces a fact’s tags of one origin, and lists tagged slides in deck order', () => {
    course.setTopics(firstFact(second), 'tagger', tags('cells', 'water'));
    course.setTopics(firstFact(first), 'tagger', tags('cells'));
    course.setTopics(firstFact(second), 'tagger', tags('water'));
    expect(course.slidesTagged(TopicTag.parse('cells')).map((s) => s.body)).toEqual(['first']);
    expect(course.slidesTagged(TopicTag.parse('water')).map((s) => s.body)).toEqual([
      'second\nsecond again',
    ]);
    expect(course.slidesTagged(TopicTag.parse('absent'))).toEqual([]);
  });

  it('keeps the other origin’s tags and the slide’s other facts’ tags when one is replaced', () => {
    const secondChunk = { sourceId: second, chunkNo: ChunkNo.parse(2) };
    course.setTopics(firstFact(second), 'tagger', tags('cells', 'water'));
    course.setTopics(firstFact(second), 'student', tags('osmosis'));
    course.setTopics(secondChunk, 'tagger', tags('pressure'));
    course.setTopics(firstFact(second), 'tagger', tags('water'));
    expect(course.topics(second)).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'osmosis' },
      { chunkNo: 1, origin: 'tagger', tag: 'water' },
      { chunkNo: 2, origin: 'tagger', tag: 'pressure' },
    ]);
    course.setTopics(firstFact(second), 'student', []);
    expect(course.topics(second).map(({ tag }) => tag)).toEqual(['water', 'pressure']);
  });

  it('reports a fact the course does not hold: an unknown slide, or a chunk past its last', () => {
    for (const fact of [
      firstFact(SourceId.parse('lecture-9/1')),
      { sourceId: first, chunkNo: ChunkNo.parse(2) },
    ])
      expect(course.setTopics(fact, 'tagger', tags('cells'))).toEqual({ status: 'no-such-fact' });
    expect(course.topics(first)).toEqual([]);
    expect(course.topics(SourceId.parse('lecture-9/1'))).toEqual([]);
  });

  it('stores a tag given twice once', () => {
    course.setTopics(firstFact(first), 'tagger', tags('cells', 'cells'));
    expect(course.topics(first)).toEqual([{ chunkNo: 1, origin: 'tagger', tag: 'cells' }]);
  });
});

describe('CourseIndex.replaceEmbedder', () => {
  const NEW = EmbedderIdentity.parse({ model: 'new', dimension: 2 });

  beforeEach(() => {
    indexLectures(course, [
      indexed(slide({ slideNo: 1 }), AWAY),
      indexed(slide({ slideNo: 2 }), AWAY),
    ]);
  });

  it('refuses embeddings that miss a slide, name a slide the course lacks, or have the wrong dimension', () => {
    expect(() => {
      course.replaceEmbedder(NEW, [indexed(slide({ slideNo: 1 }), vector(1, 0))]);
    }).toThrow(/no embedding for lecture-1\/2/);
    const extra = [
      indexed(slide({ slideNo: 1 }), vector(1, 0)),
      indexed(slide({ slideNo: 2 }), vector(0, 1)),
      indexed(slide({ lectureId: 'lecture-9' }), vector(1, 1)),
    ];
    expect(() => {
      course.replaceEmbedder(NEW, extra);
    }).toThrow(/lacks/);
    expect(() => {
      course.replaceEmbedder(NEW, [
        indexed(slide({ slideNo: 1 }), vector(1, 0)),
        indexed(slide({ slideNo: 2 }), vector(0, 1, 0)),
      ]);
    }).toThrow(/3 dimensions/);
    expect(course.search({ text: '', embedding: AWAY }, 2)).toHaveLength(2);
  });
});

describe('CourseIndex.replaceEmbedder and topic tags', () => {
  const one = slide({ slideNo: 1, body: 'one' });
  const two = slide({ slideNo: 2, body: 'two\ntwo again' });
  const dimension2 = (model: string) => EmbedderIdentity.parse({ model, dimension: 2 });
  beforeEach(() => {
    indexLectures(course, [indexed(one, AWAY), indexed(two, AWAY)]);
    course.setTopics(firstFact(sourceIdOf(one)), 'student', [TopicTag.parse('cells')]);
    course.setTopics(firstFact(sourceIdOf(two)), 'tagger', [TopicTag.parse('water')]);
  });

  it('keeps each tag on its fact when the slides are cut the same way', () => {
    course.replaceEmbedder(dimension2('new'), [
      indexed(one, vector(1, 0)),
      indexed(two, vector(0, 1)),
    ]);
    expect(course.topics(sourceIdOf(one))).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'cells' },
    ]);
    expect(course.topics(sourceIdOf(two))).toEqual([
      { chunkNo: 1, origin: 'tagger', tag: 'water' },
    ]);
  });

  it('puts a re-cut slide’s tags on every new fact, and leaves an uncut slide’s alone', () => {
    course.replaceEmbedder(dimension2('new'), [
      indexed(one, vector(1, 0)),
      chunked(two, vector(1, 0), vector(0, 1)),
    ]);
    expect(course.topics(sourceIdOf(two))).toEqual([
      { chunkNo: 1, origin: 'tagger', tag: 'water' },
      { chunkNo: 2, origin: 'tagger', tag: 'water' },
    ]);
    expect(course.topics(sourceIdOf(one))).toEqual([
      { chunkNo: 1, origin: 'student', tag: 'cells' },
    ]);
  });
});
