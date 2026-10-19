import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseId, SlideRecord } from '@cram/shared';
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
