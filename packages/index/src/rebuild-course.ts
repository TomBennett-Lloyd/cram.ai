import Database from 'better-sqlite3';
import { existsSync, renameSync, rmSync } from 'node:fs';
import type { CourseId, Deck, DiscardedTable, LectureId, SlideRecord } from '@cram/shared';
import { z } from 'zod';
import { CHUNK_TABLE_NAME } from './chunk-row';
import type { CourseIndex } from './course-index';
import {
  embedSlides,
  openCourse,
  type EmbedSlides,
  type OpenCourseResult,
  type OpenCourseSpec,
} from './open-course';
import { readRebuildReport, REBUILD_REPORT_TABLE_NAME } from './rebuild-report';
import {
  readDeck,
  readSlideImages,
  STORED_DECK_TABLE_NAMES,
  storedLectureIds,
} from './stored-deck';

/** A stored deck read again: its slide records as ingest emits them, or a deck that no longer reads. */
export type ParsedDeck =
  | { readonly status: 'parsed'; readonly slides: readonly SlideRecord[] }
  | { readonly status: 'unreadable' };

/** Injected so the index never depends on ingest (#9). */
export type ParseDeck = (deck: Deck, courseId: CourseId) => Promise<ParsedDeck>;

export interface RebuildDeps {
  readonly parse: ParseDeck;
  readonly embed: EmbedSlides;
}

export type RebuildCourseResult =
  | Exclude<OpenCourseResult, { status: 'older-schema' }>
  | { readonly status: 'no-stored-decks'; readonly fileVersion: number }
  | { readonly status: 'deck-unreadable'; readonly lectureId: LectureId }
  | {
      readonly status: 'rebuilt';
      readonly course: CourseIndex;
      readonly discarded: readonly DiscardedTable[];
    };

/**
 * What a rebuild reproduces: the course row from the spec, the slides from the decks, the decks,
 * and the report of what an earlier rebuild discarded, which the rebuilt file's report adds to.
 */
const REPRODUCED_TABLES: ReadonlySet<string> = new Set([
  'course',
  'slides',
  CHUNK_TABLE_NAME,
  ...STORED_DECK_TABLE_NAMES,
  REBUILD_REPORT_TABLE_NAME,
]);

const TableList = z.array(z.object({ name: z.string(), type: z.string() }));

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * The tables of `db` a rebuild does not reproduce. Ordinary tables only: a virtual table indexes
 * rows held elsewhere, and its shadow tables are named `<virtual>_<suffix>`; `vec0` names some
 * that SQLite itself lists as ordinary.
 */
export const unreproducedTables = (db: Database.Database): readonly string[] => {
  const tables = TableList.parse(db.pragma('table_list'));
  const virtual = tables.filter(({ type }) => type === 'virtual').map(({ name }) => `${name}_`);
  return tables
    .filter(
      ({ name, type }) =>
        type === 'table' &&
        !name.startsWith('sqlite_') &&
        !REPRODUCED_TABLES.has(name) &&
        !virtual.some((prefix) => name.startsWith(prefix)),
    )
    .map(({ name }) => name);
};

const discardedTables = (db: Database.Database): readonly DiscardedTable[] =>
  unreproducedTables(db)
    .map((table) => ({
      table,
      rows: z.number().parse(
        db
          .prepare(`select count(*) from ${quoted(table)}`)
          .pluck()
          .get(),
      ),
    }))
    .filter(({ rows }) => rows > 0);

const hasTable = (db: Database.Database, name: string): boolean =>
  db
    .prepare("select count(*) from sqlite_schema where type = 'table' and name = ?")
    .pluck()
    .get(name) === 1;

/** The rebuilt file was written whole, or the first stored deck that no longer reads stopped it. */
type Written =
  | { readonly status: 'written' }
  | { readonly status: 'deck-unreadable'; readonly lectureId: LectureId };

const writeRebuilt = async (
  old: Database.Database,
  spec: OpenCourseSpec,
  deps: RebuildDeps,
  discarded: readonly DiscardedTable[],
): Promise<Written> => {
  const created = openCourse(spec);
  if (created.status !== 'open')
    throw new Error(`rebuildCourse: ${spec.path} did not open blank: ${created.status}`);
  const { course } = created;
  try {
    for (const lectureId of storedLectureIds(old)) {
      const deck = readDeck(old, lectureId);
      if (deck === undefined) throw new Error(`rebuildCourse: deck ${lectureId} vanished mid-read`);
      try {
        const parsed = await deps.parse(deck, spec.courseId);
        if (parsed.status === 'unreadable') return { status: 'deck-unreadable', lectureId };
        const slides = await embedSlides('rebuildCourse', parsed.slides, deps.embed);
        course.replaceLecture(deck, readSlideImages(old, lectureId), slides);
      } catch (error) {
        throw new Error(`rebuildCourse: lecture ${lectureId} did not rebuild`, { cause: error });
      }
    }
    if (hasTable(old, REBUILD_REPORT_TABLE_NAME))
      course.recordRebuildReport(readRebuildReport(old));
    course.recordRebuildReport(discarded);
    return { status: 'written' };
  } finally {
    course.close();
  }
};

/**
 * Opens a course, first rebuilding it from its stored decks if its schema is older
 * (`docs/adr/0004-storage.md` § Decision (d)). The older file is replaced only once
 * the rebuilt one is complete. `discarded` is this rebuild's; the rebuilt file's
 * `rebuildReport` also holds what an earlier one discarded and the student has not dismissed.
 */
export const rebuildCourse = async (
  spec: OpenCourseSpec,
  deps: RebuildDeps,
): Promise<RebuildCourseResult> => {
  const opened = openCourse(spec);
  if (opened.status !== 'older-schema') return opened;
  const rebuilt = `${spec.path}-rebuild`;
  const old = new Database(spec.path, { fileMustExist: true });
  let discarded: readonly DiscardedTable[];
  try {
    const recorded = z.string().parse(old.prepare('select course_id from course').pluck().get());
    if (recorded !== spec.courseId) return { status: 'course-mismatch', recorded };
    if (!hasTable(old, 'decks'))
      return { status: 'no-stored-decks', fileVersion: opened.fileVersion };
    discarded = discardedTables(old);
    rmSync(rebuilt, { force: true });
    const written = await writeRebuilt(old, { ...spec, path: rebuilt }, deps, discarded);
    if (written.status === 'deck-unreadable') {
      rmSync(rebuilt, { force: true });
      return written;
    }
  } catch (error) {
    rmSync(rebuilt, { force: true });
    throw error;
  } finally {
    old.close();
  }
  if (existsSync(`${spec.path}-wal`)) {
    rmSync(rebuilt, { force: true });
    throw new Error(
      `rebuildCourse: another connection holds ${spec.path} open, so its WAL would outlive the swap`,
    );
  }
  renameSync(rebuilt, spec.path);
  const reopened = openCourse(spec);
  if (reopened.status !== 'open')
    throw new Error(`rebuildCourse: rebuilt ${spec.path} did not reopen: ${reopened.status}`);
  return { status: 'rebuilt', course: reopened.course, discarded };
};
