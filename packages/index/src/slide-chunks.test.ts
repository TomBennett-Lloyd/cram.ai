import { ChunkNo, type SlideRecord } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chunked,
  deck,
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  type TempCourse,
  vector,
} from './course-fixture';
import type { CourseIndex, SearchQuery } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import type { IndexedChunk, IndexedSlide } from './indexed-slide';
import { sourceIdOf } from './slide-row';

// Slides indexed as several chunks (`docs/adr/0008-slide-chunking.md`).

const NEAR = vector(1, 0, 0, 0);
const AWAY = vector(0, 0, 0, 1);

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

const slideNos = (query: Partial<SearchQuery> & { readonly text: string }, k: number) =>
  course.search({ embedding: AWAY, ...query }, k).map(({ record }) => record.slideNo);

const SPLIT = slide({ slideNo: 1, title: 'Hive', body: 'osmosis\ndiffusion\nactive transport' });

describe('a slide indexed as several chunks', () => {
  beforeEach(() => {
    indexLectures(course, [
      chunked(SPLIT, AWAY, NEAR, AWAY),
      indexed(slide({ slideNo: 2, body: 'wax' }), AWAY),
    ]);
  });

  it('stores its chunks in order and lists the slide once, whole', () => {
    expect(course.chunks(sourceIdOf(SPLIT)).map(({ chunkNo, body }) => [chunkNo, body])).toEqual([
      [1, 'osmosis'],
      [2, 'diffusion'],
      [3, 'active transport'],
    ]);
    expect(course.slides().map(({ body }) => body)).toEqual([SPLIT.body, 'wax']);
  });

  it('is returned once, whole, by any one chunk’s words or vector', () => {
    for (const text of ['osmosis', 'diffusion', 'active'])
      expect(
        course.search({ text, embedding: AWAY }, 3).filter(({ record }) => record.slideNo === 1),
      ).toEqual([{ sourceId: sourceIdOf(SPLIT), record: SPLIT }]);
    expect(slideNos({ text: '', embedding: NEAR }, 1)).toEqual([1]);
    expect(slideNos({ text: 'osmosis diffusion active transport' }, 2)).toEqual([1, 2]);
  });

  it('counts k in slides, however many of a slide’s chunks match', () => {
    expect(slideNos({ text: '' }, 2).sort()).toEqual([1, 2]);
  });

  it('is not reported unembedded', () => {
    expect(course.lectures()[0]?.unembedded).toEqual([]);
  });

  it('leaves no chunk of the old slide behind when its lecture is replaced', () => {
    course.replaceLecture(deck(), [], [indexed(slide({ slideNo: 1, body: 'osmosis' }), NEAR)]);
    expect(course.chunks(sourceIdOf(SPLIT)).map(({ body }) => body)).toEqual(['osmosis']);
    expect(slideNos({ text: 'diffusion' }, 3)).toEqual([1]);
    expect(
      course.search({ text: 'diffusion', embedding: NEAR }, 3).map(({ record }) => record.body),
    ).toEqual(['osmosis']);
  });
});

describe('search over chunked slides', () => {
  it('dedupes each ranked list to slides before fusing them', () => {
    // A's three chunks lead the words list and push B to its 4th row; C trails D and E in the vector
    // list. Deduped first, B is 2nd in its list and outranks C; fused first, C would take its place.
    const close = (y: number) => vector(1, y, 0, 0);
    indexLectures(course, [
      chunked(
        slide({ slideNo: 1, body: 'nectar nectar\nnectar nectar\nnectar nectar' }),
        AWAY,
        AWAY,
        AWAY,
      ),
      indexed(slide({ slideNo: 2, body: 'nectar is stored in the comb by the bees' }), undefined),
      indexed(slide({ slideNo: 3, body: 'propolis' }), close(1)),
      indexed(slide({ slideNo: 4, body: 'pollen' }), close(0)),
      indexed(slide({ slideNo: 5, body: 'wax' }), close(0.5)),
    ]);
    const top = slideNos({ text: 'nectar', embedding: NEAR }, 4);
    expect(top).toContain(2);
    expect(top).not.toContain(3);
  });

  it('leaves every chunk of an excluded slide out of both lists', () => {
    const references = slide({ slideNo: 1, kind: 'references', body: 'nectar\nnectar again' });
    const derived = slide({ slideNo: 2, derived: true, body: 'nectar\nnectar too' });
    indexLectures(course, [
      chunked(references, NEAR, NEAR),
      chunked(derived, NEAR, NEAR),
      indexed(slide({ slideNo: 3, body: 'wax' }), AWAY),
    ]);
    const query = { text: 'nectar', embedding: NEAR };
    expect(slideNos(query, 3).sort()).toEqual([2, 3]);
    expect(slideNos({ ...query, includeReferences: true }, 3).sort()).toEqual([1, 2, 3]);
    expect(slideNos({ ...query, excludeUnconfirmedDerived: true }, 3)).toEqual([3]);
  });
});

describe('the chunks a batch may hold', () => {
  const chunk = (
    chunkNo: number,
    body: string,
    embedding: Float32Array | undefined = NEAR,
    title = SPLIT.title,
  ): IndexedChunk => ({
    chunk: { chunkNo: ChunkNo.parse(chunkNo), title, body, speakerNotes: '', imageCaptions: [] },
    embedding,
  });
  const batch = (...chunks: [IndexedChunk, ...IndexedChunk[]]): IndexedSlide[] => [
    { record: SPLIT, chunks },
  ];
  const refused = (slides: IndexedSlide[], reason: RegExp) => {
    expect(() => {
      course.replaceLecture(deck(), [], slides);
    }).toThrow(reason);
    expect(course.slides()).toEqual([]);
  };

  it('refuses chunks numbered other than 1..n in order', () => {
    refused(batch(chunk(1, 'osmosis'), chunk(3, 'diffusion')), /numbered 1\.\.n/);
    refused(batch(chunk(1, 'osmosis'), chunk(1, 'diffusion')), /numbered 1\.\.n/);
    refused(batch(chunk(2, 'osmosis')), /numbered 1\.\.n/);
  });

  it('refuses a chunk holding a line or a title its slide does not', () => {
    refused(
      batch(chunk(1, 'osmosis'), chunk(2, 'diffusion\nnot on the slide')),
      /line its slide does not/,
    );
    refused(batch(chunk(1, 'osmo')), /line its slide does not/);
    refused(batch(chunk(1, 'osmosis', NEAR, 'Other')), /title is not its slide's/);
  });

  it('refuses a caption or a note line its slide does not hold, field by field', () => {
    const noted: SlideRecord = { ...SPLIT, speakerNotes: 'osmosis' };
    const asNote: IndexedChunk = {
      chunk: {
        chunkNo: ChunkNo.parse(1),
        title: 'Hive',
        body: '',
        speakerNotes: 'diffusion',
        imageCaptions: [],
      },
      embedding: NEAR,
    };
    expect(() => {
      course.replaceLecture(deck(), [], [{ record: noted, chunks: [asNote] }]);
    }).toThrow(/line its slide does not/);
  });

  it('refuses a split slide with a chunk outside the vector list, and a vector of the wrong dimension', () => {
    refused(
      batch(chunk(1, 'osmosis'), { ...chunk(2, 'diffusion'), embedding: undefined }),
      /every chunk needs a vector/,
    );
    refused(
      batch(chunk(1, 'osmosis'), chunk(2, 'diffusion', vector(1, 0))),
      /chunk 2\): embedding has 2 dimensions/,
    );
  });
});

describe('CourseIndex.replaceEmbedder over chunks', () => {
  it('rewrites each slide’s chunks, so a new embedder re-chunks the course', () => {
    const NEW = EmbedderIdentity.parse({ model: 'new', dimension: 2 });
    indexLectures(course, [indexed(SPLIT, AWAY)]);
    course.replaceEmbedder(NEW, [chunked(SPLIT, vector(0, 1), vector(1, 0))]);
    expect(course.chunks(sourceIdOf(SPLIT))).toHaveLength(2);
    expect(course.search({ text: '', embedding: vector(1, 0) }, 1)[0]?.record).toEqual(SPLIT);
    expect(course.search({ text: 'transport', embedding: vector(0, 1) }, 1)[0]?.record).toEqual(
      SPLIT,
    );
    course.replaceEmbedder(NEW, [indexed(SPLIT, vector(1, 0))]);
    expect(course.chunks(sourceIdOf(SPLIT))).toHaveLength(1);
  });
});
