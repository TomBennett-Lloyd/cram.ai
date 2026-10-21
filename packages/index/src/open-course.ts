import Database, { SqliteError } from 'better-sqlite3';
import type { CourseId, SlideRecord } from '@cram/shared';
import * as sqliteVec from 'sqlite-vec';
import { z } from 'zod';
import { CourseIndex } from './course-index';
import type { IndexedSlide } from './indexed-slide';
import { type EmbedderIdentity, sameEmbedder } from './embedder-identity';
import { classifySchema, createSchema } from './schema';
import { sourceIdOf } from './slide-row';

export interface OpenCourseSpec {
  readonly path: string;
  readonly courseId: CourseId;
  readonly embedder: EmbedderIdentity;
}

/** What a course file's `course` row holds, compared as stored rather than parsed: a course file is external input (#300). */
const CourseRow = z
  .object({ course_id: z.string(), embedder_model: z.string(), embedder_dimension: z.number() })
  .transform((row) => ({
    courseId: row.course_id,
    embedder: { model: row.embedder_model, dimension: row.embedder_dimension },
  }));
type CourseRow = z.infer<typeof CourseRow>;

/**
 * Every state a course file can be in when opened. Only `open` holds a connection;
 * `older-schema` is `rebuildCourse`'s to rebuild, never migrated (`docs/adr/0004-storage.md` § Decision (d)).
 * A mismatch's `recorded` is what the file holds, which need not pass `CourseId` or `EmbedderIdentity`.
 */
export type OpenCourseResult =
  | { readonly status: 'open'; readonly course: CourseIndex }
  | { readonly status: 'newer-schema' | 'older-schema'; readonly fileVersion: number }
  | { readonly status: 'not-a-course-file' }
  | { readonly status: 'course-mismatch'; readonly recorded: CourseRow['courseId'] }
  | { readonly status: 'embedder-mismatch'; readonly recorded: CourseRow['embedder'] };

/** A course opened only to be read: its type has no write. */
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

/** A blank or current file keeps its connection; any other is closed and refused. */
const classify = (
  db: Database.Database,
):
  | { readonly status: 'blank' }
  | { readonly status: 'current' }
  | Extract<
      OpenCourseResult,
      { status: 'newer-schema' | 'older-schema' | 'not-a-course-file' }
    > => {
  const state = readState(db);
  if (state === undefined) return { status: 'not-a-course-file' };
  if (state.schema === 'blank') return { status: 'blank' };
  if (state.schema === 'current') return { status: 'current' };
  db.close();
  if (state.schema === 'foreign') return { status: 'not-a-course-file' };
  return {
    status: state.schema === 'newer' ? 'newer-schema' : 'older-schema',
    fileVersion: state.fileVersion,
  };
};

/**
 * `course` is under `spec.embedder` whatever the file records; only `reembedCourse` keeps one
 * whose `recorded` differs, and it replaces the recorded embedder before anything else.
 */
type OpenedFile =
  | Exclude<OpenCourseResult, { status: 'open' | 'embedder-mismatch' }>
  | {
      readonly status: 'opened';
      readonly course: CourseIndex;
      readonly recorded: CourseRow['embedder'];
    };

/** Runs `prepare`, then checks the stored course row against `spec` and hands `db` over, or closes it. */
const handOver = (
  db: Database.Database,
  spec: OpenCourseSpec,
  prepare: (db: Database.Database) => void,
): OpenedFile => {
  let handedOver = false;
  try {
    sqliteVec.load(db);
    prepare(db);
    const row = CourseRow.parse(
      db.prepare('select course_id, embedder_model, embedder_dimension from course').get(),
    );
    if (row.courseId !== spec.courseId)
      return { status: 'course-mismatch', recorded: row.courseId };
    handedOver = true;
    return {
      status: 'opened',
      course: new CourseIndex(db, spec.courseId, spec.embedder),
      recorded: row.embedder,
    };
  } finally {
    if (!handedOver) db.close();
  }
};

const openFile = (spec: OpenCourseSpec): OpenedFile => {
  const db = new Database(spec.path);
  const state = classify(db);
  if (state.status !== 'blank' && state.status !== 'current') return state;
  return handOver(db, spec, (opened) => {
    opened.pragma('journal_mode = WAL');
    if (state.status === 'blank') createSchema(opened, spec.courseId, spec.embedder);
  });
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

/**
 * Opens the course file at `spec.path`, which must exist, without changing what it holds: it sends no
 * write and no journal-mode pragma, and `query_only` refuses the writes a `CourseReader` cannot name.
 * It is not SQLite's read-only flag, because a read-only connection cannot remove the WAL files it
 * opens beside a course file, and a closed course file holds none (`rebuildCourse`;
 * `apps/server/src/repair.test.ts`). The cost: closing the last connection checkpoints the WAL,
 * which rewrites committed pages but not what the file holds.
 */
export const openCourseReadOnly = (spec: OpenCourseSpec): ReadCourseResult => {
  const db = new Database(spec.path, { fileMustExist: true });
  db.pragma('query_only = true');
  const state = classify(db);
  if (state.status === 'blank') {
    db.close();
    return { status: 'blank' };
  }
  if (state.status !== 'current') return state;
  return underSpecEmbedder(
    handOver(db, spec, () => undefined),
    spec,
  );
};

/** Each slide indexed as its chunks (`IndexedSlide`), in the order given. */
export type EmbedSlides = (slides: readonly SlideRecord[]) => Promise<readonly IndexedSlide[]>;

/** Each slide as `embed` indexed it, refused unless it returns exactly those slides in order. */
export const embedSlides = async (
  operation: string,
  slides: readonly SlideRecord[],
  embed: EmbedSlides,
): Promise<readonly IndexedSlide[]> => {
  const indexed = await embed(slides);
  if (indexed.length !== slides.length) {
    throw new Error(
      `${operation}: embed returned ${String(indexed.length)} indexed slides for ${String(slides.length)} slides`,
    );
  }
  slides.forEach((record, index) => {
    const returned = indexed[index]?.record;
    if (returned === undefined || sourceIdOf(returned) !== sourceIdOf(record))
      throw new Error(`${operation}: embed returned slide ${String(index)} out of order`);
  });
  return indexed;
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
      course.replaceEmbedder(
        spec.embedder,
        await embedSlides('reembedCourse', course.slides(), embed),
      );
    }
    opened = true;
    return { status: 'open', course };
  } finally {
    if (!opened) course.close();
  }
};
