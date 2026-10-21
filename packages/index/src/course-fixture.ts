import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChunkNo, CourseId, Deck, SlideImage, SlideRecord } from '@cram/shared';
import type { z } from 'zod';
import type { CourseIndex } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import { type IndexedSlide, wholeSlide } from './indexed-slide';
import { type EmbedSlides, openCourse, type OpenCourseSpec } from './open-course';

export const COURSE = CourseId.parse('course-a');
export const EMBEDDER = EmbedderIdentity.parse({ model: 'fixture-embedder', dimension: 4 });

export const slide = (overrides: Partial<z.input<typeof SlideRecord>> = {}): SlideRecord =>
  SlideRecord.parse({
    courseId: COURSE,
    lectureId: 'lecture-1',
    lectureTitle: 'Lecture 1',
    slideNo: 1,
    kind: 'content',
    title: '',
    body: '',
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'hash',
    ...overrides,
  });

export const deck = (overrides: Partial<z.input<typeof Deck>> = {}): Deck =>
  Deck.parse({
    lectureId: 'lecture-1',
    lectureTitle: 'Lecture 1',
    mediaType: 'application/pdf',
    content: new TextEncoder().encode('deck bytes'),
    ...overrides,
  });

export const slideImage = (slideNo: number, content: string): SlideImage =>
  SlideImage.parse({ slideNo, mediaType: 'image/png', content: new TextEncoder().encode(content) });

/** Writes each lecture the slides name, whole, through `CourseIndex.replaceLecture`, with a fixture deck and no images. */
export const indexLectures = (course: CourseIndex, slides: readonly IndexedSlide[]): void => {
  const lectureIds = new Set(slides.map(({ record }) => record.lectureId));
  for (const lectureId of lectureIds) {
    const lecture = slides.filter(({ record }) => record.lectureId === lectureId);
    course.replaceLecture(deck({ lectureId, lectureTitle: `Deck for ${lectureId}` }), [], lecture);
  }
};

/** File bytes as text, so a test compares contents whatever the byte-array class. */
export const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

export const vector = (...values: number[]): Float32Array => new Float32Array(values);

/** The slide as one whole chunk. */
export const indexed = (record: SlideRecord, embedding: Float32Array | undefined): IndexedSlide =>
  wholeSlide(record, embedding);

/** The slide indexed as one chunk per embedding: its body lines dealt out in order as evenly as they go, its notes and captions in the last chunk. */
export const chunked = (
  record: SlideRecord,
  first: Float32Array,
  ...rest: Float32Array[]
): IndexedSlide => {
  const lines = record.body.split('\n');
  const embeddings = [first, ...rest];
  const per = Math.ceil(lines.length / embeddings.length);
  const [head, ...tail] = embeddings.map((embedding, index) => ({
    chunk: {
      chunkNo: ChunkNo.parse(index + 1),
      title: record.title,
      body: lines.slice(index * per, (index + 1) * per).join('\n'),
      speakerNotes: index === embeddings.length - 1 ? record.speakerNotes : '',
      imageCaptions: index === embeddings.length - 1 ? record.imageCaptions : [],
    },
    embedding,
  }));
  if (head === undefined) throw new Error('chunked: no embedding');
  return { record, chunks: [head, ...tail] };
};

/** An `EmbedSlides` that indexes each slide whole, with the vector `vectors` gives it in order. */
export const embedWhole =
  (
    vectors: (slides: readonly SlideRecord[]) => Promise<readonly (Float32Array | undefined)[]>,
  ): EmbedSlides =>
  async (slides) => {
    const embeddings = await vectors(slides);
    return slides
      .slice(0, embeddings.length)
      .map((record, index) => wholeSlide(record, embeddings[index]));
  };

export interface TempCourse {
  readonly dir: string;
  readonly spec: OpenCourseSpec;
  readonly remove: () => void;
}

export const tempCourse = (embedder: EmbedderIdentity = EMBEDDER): TempCourse => {
  const dir = mkdtempSync(join(tmpdir(), 'cram-index-'));
  return {
    dir,
    spec: { path: join(dir, 'course-a.sqlite'), courseId: COURSE, embedder },
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

export const openOrFail = (spec: OpenCourseSpec): CourseIndex => {
  const result = openCourse(spec);
  if (result.status !== 'open') throw new Error(`expected an open course, got ${result.status}`);
  return result.course;
};
