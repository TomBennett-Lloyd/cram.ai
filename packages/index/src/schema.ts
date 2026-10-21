import type { Database } from 'better-sqlite3';
import { SlideKind, type CourseId } from '@cram/shared';
import { CONFIRMATION_TABLE } from './confirmation';
import type { EmbedderIdentity } from './embedder-identity';
import { REBUILD_REPORT_TABLE } from './rebuild-report';
import { STORED_DECK_TABLES } from './stored-deck';

/**
 * Held in `PRAGMA user_version`; no migration reads an older one (`docs/adr/0004-storage.md` § Decision (d)).
 * It also versions the records `@cram/ingest` stores, so a change to them moves it too:
 * `packages/ingest/src/stored-output-pin.test.ts` fails on one its corpus reaches until it has (#257). Carriers:
 * `.claude/ledgers/schema-version.ledger`.
 */
export const SCHEMA_VERSION = 6;

export type SchemaState = 'blank' | 'current' | 'older' | 'newer' | 'foreign';

/** What a file holds before its version is read: nothing, this app's `course` table, or anything else. */
export type FileContents = 'empty' | 'course' | 'other';

export const classifySchema = (
  fileVersion: number,
  contents: FileContents,
  appVersion: number = SCHEMA_VERSION,
): SchemaState => {
  if (contents === 'empty' && fileVersion === 0) return 'blank';
  if (contents !== 'course' || fileVersion === 0) return 'foreign';
  if (fileVersion > appVersion) return 'newer';
  return fileVersion < appVersion ? 'older' : 'current';
};

const KINDS = SlideKind.options.map((kind) => `'${kind}'`).join(', ');

/** The `topics` table's name is reported by a rebuild that discards it; its ledger: `.claude/ledgers/topics-table.ledger`. */
const TABLES = `
  create table course (
    singleton integer primary key check (singleton = 1),
    course_id text not null,
    embedder_model text not null,
    embedder_dimension integer not null
  ) strict;
  create table slides (
    id integer primary key,
    source_id text not null unique,
    lecture_id text not null,
    lecture_title text not null,
    slide_no integer not null,
    kind text not null check (kind in (${KINDS})),
    title text not null,
    body text not null,
    speaker_notes text not null,
    image_captions text not null,
    derived integer not null check (derived in (0, 1)),
    source_hash text not null,
    text_hash text not null
  ) strict;
  create virtual table slides_fts using fts5(
    lecture_title, title, body, speaker_notes, image_captions,
    content = '', contentless_delete = 1
  );
  create table topics (
    slide_id integer not null references slides (id),
    tag text not null,
    primary key (slide_id, tag)
  ) strict;
  create index topics_by_tag on topics (tag);
`;

export const createVectorTable = (db: Database, dimension: number): void => {
  db.exec(
    `create virtual table slide_vec using vec0(embedding float[${String(dimension)}] distance_metric=cosine)`,
  );
};

export const createSchema = (
  db: Database,
  courseId: CourseId,
  embedder: EmbedderIdentity,
): void => {
  db.transaction(() => {
    db.exec(TABLES);
    db.exec(STORED_DECK_TABLES);
    db.exec(CONFIRMATION_TABLE);
    db.exec(REBUILD_REPORT_TABLE);
    createVectorTable(db, embedder.dimension);
    db.prepare(
      'insert into course (singleton, course_id, embedder_model, embedder_dimension) values (1, ?, ?, ?)',
    ).run(courseId, embedder.model, embedder.dimension);
    db.pragma(`user_version = ${String(SCHEMA_VERSION)}`);
  })();
};
