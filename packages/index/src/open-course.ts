import Database, { SqliteError } from 'better-sqlite3';
import { CourseId, type SlideRecord, type SourceId } from '@cram/shared';
import * as sqliteVec from 'sqlite-vec';
import { z } from 'zod';
import { CourseIndex, type IndexedSlide } from './course-index';
import { EmbedderIdentity, sameEmbedder } from './embedder-identity';
import { classifySchema, createSchema } from './schema';
import { sourceIdOf } from './slide-row';

export interface OpenCourseSpec {
  readonly path: string;
  readonly courseId: CourseId;
  readonly embedder: EmbedderIdentity;
}

/**
 * Every state a course file can be in when opened. Only `open` holds a connection;
 * `older-schema` is `rebuildCourse`'s to rebuild, never migrated (`docs/adr/0004-storage.md` § Decision (d)).
 */
export type OpenCourseResult =
  | { readonly status: 'open'; readonly course: CourseIndex }
  | { readonly status: 'newer-schema' | 'older-schema'; readonly fileVersion: number }
  | { readonly status: 'not-a-course-file' }
  | { readonly status: 'course-mismatch'; readonly recorded: CourseId }
  | { readonly status: 'embedder-mismatch'; readonly recorded: EmbedderIdentity };

const CourseRow = z.object({
  course_id: CourseId,
  embedder_model: z.string(),
  embedder_dimension: z.number(),
});

/** `undefined` when the file is not SQLite at all; the connection is closed on every failure. */
const readState = (db: Database.Database) => {
  try {
    const fileVersion = z.number().parse(db.pragma('user_version', { simple: true }));
    const tables = z.number().parse(db.prepare('select count(*) from sqlite_schema').pluck().get());
    const course = db
      .prepare("select count(*) from sqlite_schema where type = 'table' and name = 'course'")
      .pluck()
      .get();
    const contents = tables === 0 ? 'empty' : course === 1 ? 'course' : 'other';
    return { fileVersion, schema: classifySchema(fileVersion, contents) };
  } catch (error) {
    db.close();
    if (error instanceof SqliteError && error.code === 'SQLITE_NOTADB') return undefined;
    throw error;
  }
};

type OpenedFile =
  | Exclude<OpenCourseResult, { status: 'open' | 'embedder-mismatch' }>
  | {
      readonly status: 'opened';
      readonly course: CourseIndex;
      readonly recorded: EmbedderIdentity;
    };

const openFile = (spec: OpenCourseSpec): OpenedFile => {
  const db = new Database(spec.path);
  const state = readState(db);
  if (state === undefined) return { status: 'not-a-course-file' };
  if (state.schema !== 'blank' && state.schema !== 'current') {
    db.close();
    if (state.schema === 'foreign') return { status: 'not-a-course-file' };
    return {
      status: state.schema === 'newer' ? 'newer-schema' : 'older-schema',
      fileVersion: state.fileVersion,
    };
  }
  let handedOver = false;
  try {
    sqliteVec.load(db);
    db.pragma('journal_mode = WAL');
    if (state.schema === 'blank') createSchema(db, spec.courseId, spec.embedder);
    const row = CourseRow.parse(
      db.prepare('select course_id, embedder_model, embedder_dimension from course').get(),
    );
    if (row.course_id !== spec.courseId)
      return { status: 'course-mismatch', recorded: row.course_id };
    const recorded = EmbedderIdentity.parse({
      model: row.embedder_model,
      dimension: row.embedder_dimension,
    });
    handedOver = true;
    return { status: 'opened', course: new CourseIndex(db, row.course_id, recorded), recorded };
  } finally {
    if (!handedOver) db.close();
  }
};

/** Opens, or creates when blank, the course file at `spec.path`; a file of another embedder is never searched. */
export const openCourse = (spec: OpenCourseSpec): OpenCourseResult => {
  const file = openFile(spec);
  if (file.status !== 'opened') return file;
  if (!sameEmbedder(file.recorded, spec.embedder)) {
    file.course.close();
    return { status: 'embedder-mismatch', recorded: file.recorded };
  }
  return { status: 'open', course: file.course };
};

export type EmbedSlides = (slides: readonly SlideRecord[]) => Promise<readonly Float32Array[]>;

/** Pairs each slide with its vector from `embed`, which must return exactly one per slide. */
export const embedSlides = async (
  operation: string,
  slides: readonly SlideRecord[],
  embed: EmbedSlides,
): Promise<readonly IndexedSlide[]> => {
  const embeddings = await embed(slides);
  if (embeddings.length !== slides.length) {
    throw new Error(
      `${operation}: embed returned ${String(embeddings.length)} vectors for ${String(slides.length)} slides`,
    );
  }
  return slides.flatMap((record, index) => {
    const embedding = embeddings[index];
    return embedding === undefined ? [] : [{ record, embedding }];
  });
};

/** Opens a course under `spec.embedder`, first re-embedding every slide with `embed` if the file records another. */
export const reembedCourse = async (
  spec: OpenCourseSpec,
  embed: EmbedSlides,
): Promise<OpenCourseResult> => {
  const file = openFile(spec);
  if (file.status !== 'opened') return file;
  const { course } = file;
  let opened = false;
  try {
    if (!sameEmbedder(file.recorded, spec.embedder)) {
      const indexed = await embedSlides('reembedCourse', course.slides(), embed);
      const bySource = new Map<SourceId, Float32Array>(
        indexed.map(({ record, embedding }) => [sourceIdOf(record), embedding]),
      );
      course.replaceEmbedder(spec.embedder, bySource);
    }
    opened = true;
    return { status: 'open', course };
  } finally {
    if (!opened) course.close();
  }
};
