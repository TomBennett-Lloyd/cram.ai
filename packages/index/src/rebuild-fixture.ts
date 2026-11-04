import Database from 'better-sqlite3';
import { type CourseId, type Deck, SlideImage, SlideRecord } from '@cram/shared';
import { vi } from 'vitest';
import { COURSE, embedWhole, vector } from './course-fixture';
import type { ParsedDeck, RebuildDeps } from './rebuild-course';
import { SCHEMA_VERSION } from './schema';

/** `STORED_DECK_TABLES` as files have always held it, deliberately not imported, so a DDL change that breaks rebuilding older files fails here. */
const FROZEN_DECK_TABLES = `
  create table decks (
    lecture_id text primary key,
    lecture_title text not null,
    media_type text not null,
    content blob not null
  ) strict;
  create table slide_images (
    lecture_id text not null references decks (lecture_id),
    slide_no integer not null,
    media_type text not null,
    content blob not null,
    primary key (lecture_id, slide_no)
  ) strict;
`;

export const OLDER = SCHEMA_VERSION - 1;
export const encode = (value: string) => new TextEncoder().encode(value);

/** An older course file: the frozen deck tables beside tables this app has never defined. */
export const writeOlderFile = (
  path: string,
  options: { readonly courseId?: string; readonly decks?: boolean } = {},
): void => {
  const db = new Database(path);
  db.exec(`
    create table course (singleton integer primary key, course_id text not null, title text);
    create table notes (id integer primary key autoincrement, body text not null);
    create table attempts (id integer primary key);
    create table "exam ""marks""" (mark integer);
    insert into "exam ""marks""" values (7);
  `);
  db.prepare('insert into course (singleton, course_id, title) values (1, ?, ?)').run(
    options.courseId ?? COURSE,
    'Biology',
  );
  db.prepare('insert into notes (body) values (?), (?)').run('osmosis notes', 'diffusion notes');
  if (options.decks ?? true) {
    db.exec(FROZEN_DECK_TABLES);
    const insertDeck = db.prepare("insert into decks values (?, ?, 'application/pdf', ?)");
    insertDeck.run('lecture-1', 'Cells', encode('osmosis|diffusion'));
    insertDeck.run('lecture-2', 'Tissues', encode('epithelium'));
    db.prepare("insert into slide_images values ('lecture-1', 2, 'image/png', ?)").run(
      encode('diffusion diagram'),
    );
  }
  db.pragma(`user_version = ${String(OLDER)}`);
  db.close();
};

/** One slide per `|`-separated part of the deck's text. */
export const parse = vi.fn((stored: Deck, courseId: CourseId): Promise<ParsedDeck> =>
  Promise.resolve({
    status: 'parsed',
    slides: new TextDecoder()
      .decode(stored.content)
      .split('|')
      .map((body, index) =>
        SlideRecord.parse({
          courseId,
          lectureId: stored.lectureId,
          lectureTitle: stored.lectureTitle,
          slideNo: index + 1,
          kind: 'content',
          title: '',
          body,
          speakerNotes: '',
          imageCaptions: [],
          derived: false,
          sourceHash: 'hash',
        }),
      ),
  }),
);

export const embed = vi.fn((slides: readonly SlideRecord[]) =>
  Promise.resolve(slides.map((_, index) => vector(1, index, 0, 0))),
);

export const render = vi.fn((stored: Deck) =>
  Promise.resolve(
    new TextDecoder()
      .decode(stored.content)
      .split('|')
      .map((part, index) =>
        SlideImage.parse({
          slideNo: index + 1,
          mediaType: 'image/png',
          content: encode(`rendered ${part}`),
        }),
      ),
  ),
);

export const deps: RebuildDeps = { parse, embed: embedWhole(embed), render };

/** Moves a stored deck to `rowid`, so a key that tracks rowids differs from upload order and lecture-id order. */
export const moveDeck = (path: string, lectureId: string, rowid: number): void => {
  const db = new Database(path);
  db.prepare('update decks set rowid = ? where lecture_id = ?').run(rowid, lectureId);
  db.close();
};
