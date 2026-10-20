import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseId, Deck, SlideImage, SlideRecord } from '@cram/shared';
import type { z } from 'zod';
import type { CourseIndex, IndexedSlide } from './course-index';
import { EmbedderIdentity } from './embedder-identity';
import { openCourse, type OpenCourseSpec } from './open-course';

export const COURSE = CourseId.parse('course-a');
export const EMBEDDER = EmbedderIdentity.parse({ model: 'fixture-embedder', dimension: 4 });

export const slide = (overrides: Partial<z.input<typeof SlideRecord>> = {}): SlideRecord =>
  SlideRecord.parse({
    courseId: COURSE,
    lectureId: 'lecture-1',
    lectureTitle: 'Lecture 1',
    slideNo: 1,
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

/** Stores a deck for each lecture, which `CourseIndex.upsertSlides` requires of every slide. */
export const storeDecks = (course: CourseIndex, lectureIds: readonly string[]): void => {
  for (const lectureId of lectureIds)
    course.storeDeck(deck({ lectureId, lectureTitle: `Deck for ${lectureId}` }), []);
};

/** File bytes as text, so a test compares contents whatever the byte-array class. */
export const text = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

export const vector = (...values: number[]): Float32Array => new Float32Array(values);

export const indexed = (record: SlideRecord, embedding: Float32Array): IndexedSlide => ({
  record,
  embedding,
});

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
