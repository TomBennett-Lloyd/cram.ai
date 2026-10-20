import Database from 'better-sqlite3';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { CourseId, type Deck, type SlideRecord } from '@cram/shared';
import { z } from 'zod';
import type { CourseIndex } from './course-index';
import {
  embedSlides,
  openCourse,
  type EmbedSlides,
  type OpenCourseResult,
  type OpenCourseSpec,
} from './open-course';
import {
  readDeck,
  readSlideImages,
  STORED_DECK_TABLE_NAMES,
  storedLectureIds,
} from './stored-deck';

/** A deck's slide records, as ingest emits them; injected so the index never depends on ingest (#9). */
export type ParseDeck = (deck: Deck, courseId: CourseId) => Promise<readonly SlideRecord[]>;

export interface RebuildDeps {
  readonly parse: ParseDeck;
  readonly embed: EmbedSlides;
}

/** A table of the older file whose rows the rebuild did not carry over. */
export interface DiscardedTable {
  readonly table: string;
  readonly rows: number;
}

export type RebuildCourseResult =
  | Exclude<OpenCourseResult, { status: 'older-schema' }>
  | { readonly status: 'no-stored-decks'; readonly fileVersion: number }
  | {
      readonly status: 'rebuilt';
      readonly course: CourseIndex;
      readonly discarded: readonly DiscardedTable[];
    };

/** What a rebuild reproduces: the course row from the spec, the slides from the decks, and the decks. */
const REPRODUCED_TABLES: ReadonlySet<string> = new Set([
  'course',
  'slides',
  ...STORED_DECK_TABLE_NAMES,
]);

const TableList = z.array(z.object({ name: z.string(), type: z.string() }));

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * Ordinary tables only. A virtual table indexes rows held elsewhere, and its shadow tables are
 * named `<virtual>_<suffix>`; `vec0` names some that SQLite itself lists as ordinary.
 */
const discardedTables = (db: Database.Database): readonly DiscardedTable[] => {
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
    .map(({ name }) => ({
      table: name,
      rows: z.number().parse(
        db
          .prepare(`select count(*) from ${quoted(name)}`)
          .pluck()
          .get(),
      ),
    }))
    .filter(({ rows }) => rows > 0);
};

const hasStoredDecks = (db: Database.Database): boolean =>
  db
    .prepare("select count(*) from sqlite_schema where type = 'table' and name = 'decks'")
    .pluck()
    .get() === 1;

const writeRebuilt = async (
  old: Database.Database,
  spec: OpenCourseSpec,
  deps: RebuildDeps,
): Promise<void> => {
  const created = openCourse(spec);
  if (created.status !== 'open')
    throw new Error(`rebuildCourse: ${spec.path} did not open blank: ${created.status}`);
  const { course } = created;
  try {
    for (const lectureId of storedLectureIds(old)) {
      const deck = readDeck(old, lectureId);
      if (deck === undefined) throw new Error(`rebuildCourse: deck ${lectureId} vanished mid-read`);
      try {
        const records = await deps.parse(deck, spec.courseId);
        const slides = await embedSlides('rebuildCourse', records, deps.embed);
        course.replaceLecture(deck, readSlideImages(old, lectureId), slides);
      } catch (error) {
        throw new Error(`rebuildCourse: lecture ${lectureId} did not rebuild`, { cause: error });
      }
    }
  } finally {
    course.close();
  }
};

/**
 * Opens a course, first rebuilding it from its stored decks if its schema is older
 * (`docs/adr/0004-storage.md` § Decision (d)). The older file is replaced only once
 * the rebuilt one is complete.
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
    const recorded = CourseId.parse(old.prepare('select course_id from course').pluck().get());
    if (recorded !== spec.courseId) return { status: 'course-mismatch', recorded };
    if (!hasStoredDecks(old)) return { status: 'no-stored-decks', fileVersion: opened.fileVersion };
    discarded = discardedTables(old);
    rmSync(rebuilt, { force: true });
    await writeRebuilt(old, { ...spec, path: rebuilt }, deps);
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
