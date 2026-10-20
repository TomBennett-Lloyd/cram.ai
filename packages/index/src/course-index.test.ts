import { SourceId } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
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
    });
    indexLectures(course, [indexed(record, AWAY)]);
    expect(course.slides()).toEqual([record]);
  });
});

describe('CourseIndex topics', () => {
  beforeEach(() => {
    indexLectures(course, [
      indexed(slide({ slideNo: 2, body: 'second' }), AWAY),
      indexed(slide({ slideNo: 1, body: 'first' }), AWAY),
    ]);
  });

  it('replaces a slide’s tags, and lists tagged slides in deck order', () => {
    const first = sourceIdOf(slide({ slideNo: 1 }));
    const second = sourceIdOf(slide({ slideNo: 2 }));
    course.setTopics(second, ['cells', 'water']);
    course.setTopics(first, ['cells']);
    course.setTopics(second, ['water']);
    expect(course.slidesTagged('cells').map((s) => s.body)).toEqual(['first']);
    expect(course.slidesTagged('water').map((s) => s.body)).toEqual(['second']);
    expect(course.slidesTagged('absent')).toEqual([]);
  });

  it('reports a slide the course does not hold', () => {
    expect(course.setTopics(SourceId.parse('lecture-9/1'), ['cells'])).toEqual({
      status: 'no-such-slide',
    });
  });
});

describe('CourseIndex.replaceEmbedder', () => {
  const NEW = EmbedderIdentity.parse({ model: 'new', dimension: 2 });
  const one = sourceIdOf(slide({ slideNo: 1 }));
  const two = sourceIdOf(slide({ slideNo: 2 }));

  beforeEach(() => {
    indexLectures(course, [
      indexed(slide({ slideNo: 1 }), AWAY),
      indexed(slide({ slideNo: 2 }), AWAY),
    ]);
  });

  it('refuses embeddings that miss a slide, name a slide the course lacks, or have the wrong dimension', () => {
    expect(() => {
      course.replaceEmbedder(NEW, new Map([[one, vector(1, 0)]]));
    }).toThrow(/no embedding for lecture-1\/2/);
    const extra = new Map([
      [one, vector(1, 0)],
      [two, vector(0, 1)],
      [SourceId.parse('lecture-9/1'), vector(1, 1)],
    ]);
    expect(() => {
      course.replaceEmbedder(NEW, extra);
    }).toThrow(/lacks/);
    expect(() => {
      course.replaceEmbedder(
        NEW,
        new Map([
          [one, vector(1, 0)],
          [two, vector(0, 1, 0)],
        ]),
      );
    }).toThrow(/3 dimensions/);
    expect(course.search({ text: '', embedding: AWAY }, 2)).toHaveLength(2);
  });
});
