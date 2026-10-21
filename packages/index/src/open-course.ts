import Database, { SqliteError } from 'better-sqlite3';
import type { CourseId, SlideRecord, SourceId } from '@cram/shared';
import * as sqliteVec from 'sqlite-vec';
import { z } from 'zod';
import { CourseIndex, type IndexedSlide } from './course-index';
import { type EmbedderIdentity, sameEmbedder } from './embedder-identity';
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
 * `recorded` is what the file holds, which need not pass `CourseId`: a course file is external input (#300).
 */
export type OpenCourseResult =
  | { readonly status: 'open'; readonly course: CourseIndex }
  | { readonly status: 'newer-schema' | 'older-schema'; readonly fileVersion: number }
  | { readonly status: 'not-a-course-file' }
  | { readonly status: 'course-mismatch'; readonly recorded: string }
  | { readonly status: 'embedder-mismatch'; readonly recorded: EmbedderIdentity };

/** A course opened only to be read: its type has no write, and its connection refuses every write statement. */
export type CourseReader = Pick<
  CourseIndex,
  | 'slides'
  | 'search'
  | 'confirmation'
  | 'slidesTagged'
  | 'lectures'
  | 'rebuildReport'
  | 'deck'
  | 'slideImage'
  | 'close'
>;

/** `blank` is a file with no schema yet, which only a writer's `openCourse` creates. */
export type ReadCourseResult =
  | Exclude<OpenCourseResult, { status: 'open' }>
  | { readonly status: 'open'; readonly course: CourseReader }
  | { readonly status: 'blank' };

/** Compared as stored rather than parsed, so a malformed row is a mismatch and not a throw. */
const CourseRow = z.object({
  course_id: z.string(),
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

type Mode = 'read-write' | 'read-only';

type Connected =
  | { readonly status: 'connected'; readonly db: Database.Database; readonly blank: boolean }
  | Extract<OpenCourseResult, { status: 'newer-schema' | 'older-schema' | 'not-a-course-file' }>;

/**
 * A connection to a file holding a blank or current schema; a file holding any other is closed and refused.
 * Read-only is `query_only` rather than SQLite's read-only flag, because a read-only connection cannot
 * remove the WAL files it opens beside a course file, and a closed course file holds none
 * (`rebuildCourse`; `apps/server/src/repair.test.ts`, "leaves it closed"). The cost: closing the
 * last connection checkpoints the WAL, which rewrites committed pages but not what the file holds.
 */
const connect = (path: string, mode: Mode): Connected => {
  const db = new Database(path, mode === 'read-only' ? { fileMustExist: true } : undefined);
  if (mode === 'read-only') db.pragma('query_only = true');
  const state = readState(db);
  if (state === undefined) return { status: 'not-a-course-file' };
  if (state.schema === 'blank' || state.schema === 'current')
    return { status: 'connected', db, blank: state.schema === 'blank' };
  db.close();
  if (state.schema === 'foreign') return { status: 'not-a-course-file' };
  return {
    status: state.schema === 'newer' ? 'newer-schema' : 'older-schema',
    fileVersion: state.fileVersion,
  };
};

type OpenedFile =
  | Exclude<OpenCourseResult, { status: 'open' | 'embedder-mismatch' }>
  | {
      readonly status: 'opened';
      readonly course: CourseIndex;
      readonly recorded: EmbedderIdentity;
    };

/** Checks the stored course row against `spec` before the connection is handed over, or closes it. */
const handOver = (
  connected: Extract<Connected, { status: 'connected' }>,
  spec: OpenCourseSpec,
  mode: Mode,
): OpenedFile => {
  const { db } = connected;
  let handedOver = false;
  try {
    sqliteVec.load(db);
    if (mode === 'read-write') {
      db.pragma('journal_mode = WAL');
      if (connected.blank) createSchema(db, spec.courseId, spec.embedder);
    }
    const row = CourseRow.parse(
      db.prepare('select course_id, embedder_model, embedder_dimension from course').get(),
    );
    if (row.course_id !== spec.courseId)
      return { status: 'course-mismatch', recorded: row.course_id };
    const recorded = { model: row.embedder_model, dimension: row.embedder_dimension };
    handedOver = true;
    return { status: 'opened', course: new CourseIndex(db, spec.courseId, recorded), recorded };
  } finally {
    if (!handedOver) db.close();
  }
};

const openFile = (spec: OpenCourseSpec): OpenedFile => {
  const connected = connect(spec.path, 'read-write');
  return connected.status === 'connected' ? handOver(connected, spec, 'read-write') : connected;
};

/** `opened` only under the embedder the file records; a file of another embedder is never searched. */
const underSpecEmbedder = (file: OpenedFile, spec: OpenCourseSpec): OpenCourseResult => {
  if (file.status !== 'opened') return file;
  if (!sameEmbedder(file.recorded, spec.embedder)) {
    file.course.close();
    return { status: 'embedder-mismatch', recorded: file.recorded };
  }
  return { status: 'open', course: file.course };
};

/** Opens, or creates when blank, the course file at `spec.path`. */
export const openCourse = (spec: OpenCourseSpec): OpenCourseResult =>
  underSpecEmbedder(openFile(spec), spec);

/** Opens the course file at `spec.path`, which must exist, without changing what it holds. */
export const openCourseReadOnly = (spec: OpenCourseSpec): ReadCourseResult => {
  const connected = connect(spec.path, 'read-only');
  if (connected.status !== 'connected') return connected;
  if (connected.blank) {
    connected.db.close();
    return { status: 'blank' };
  }
  return underSpecEmbedder(handOver(connected, spec, 'read-only'), spec);
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
