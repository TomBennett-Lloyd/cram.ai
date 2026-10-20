import type { Database } from 'better-sqlite3';
import { Deck, LectureId, SlideImage, type SlideNo } from '@cram/shared';
import { z } from 'zod';

/**
 * The decks and their slide images. Their shape never changes across schema versions:
 * a newer app rebuilds an older file by reading them (`docs/adr/0004-storage.md` § Decision (d);
 * rebuild-course.test.ts pins it).
 */
export const STORED_DECK_TABLES = `
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

/** The tables `STORED_DECK_TABLES` creates. */
export const STORED_DECK_TABLE_NAMES: readonly string[] = ['decks', 'slide_images'];

const DeckRow = z.object({
  lecture_id: z.string(),
  lecture_title: z.string(),
  media_type: z.string(),
  content: z.instanceof(Uint8Array),
});

const ImageRow = z.object({
  slide_no: z.number(),
  media_type: z.string(),
  content: z.instanceof(Uint8Array),
});

const imageFromRow = (row: unknown): SlideImage => {
  const parsed = ImageRow.parse(row);
  return SlideImage.parse({
    slideNo: parsed.slide_no,
    mediaType: parsed.media_type,
    content: parsed.content,
  });
};

/**
 * Refuses a slide number twice in one batch, before anything is written: a duplicate key is the
 * caller's bug, not a storage error (`docs/standards/error-handling.md`, worked example 2).
 */
export const requireDistinctSlideImages = (
  operation: string,
  lectureId: LectureId,
  images: readonly SlideImage[],
): void => {
  const seen = new Set<SlideNo>();
  for (const { slideNo } of images) {
    if (seen.has(slideNo))
      throw new Error(
        `${operation}: slide image ${lectureId}/${String(slideNo)} appears twice in one batch`,
      );
    seen.add(slideNo);
  }
};

/** Replaces the lecture's deck and every one of its slide images, in one transaction. */
export const writeDeck = (db: Database, deck: Deck, images: readonly SlideImage[]): void => {
  const insertImage = db.prepare(
    'insert into slide_images (lecture_id, slide_no, media_type, content) values (?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.prepare('delete from slide_images where lecture_id = ?').run(deck.lectureId);
    db.prepare(
      `insert into decks (lecture_id, lecture_title, media_type, content) values (?, ?, ?, ?)
       on conflict (lecture_id) do update set
         lecture_title = excluded.lecture_title, media_type = excluded.media_type, content = excluded.content`,
    ).run(deck.lectureId, deck.lectureTitle, deck.mediaType, deck.content);
    for (const image of images)
      insertImage.run(deck.lectureId, image.slideNo, image.mediaType, image.content);
  })();
};

/** Deletes the lecture's deck and its slide images, and says whether it had a deck; the caller holds the transaction. */
export const deleteDeck = (db: Database, lectureId: LectureId): boolean => {
  db.prepare('delete from slide_images where lecture_id = ?').run(lectureId);
  return db.prepare('delete from decks where lecture_id = ?').run(lectureId).changes === 1;
};

export const readDeck = (db: Database, lectureId: LectureId): Deck | undefined => {
  const row: unknown = db
    .prepare(
      'select lecture_id, lecture_title, media_type, content from decks where lecture_id = ?',
    )
    .get(lectureId);
  if (row === undefined) return undefined;
  const parsed = DeckRow.parse(row);
  return Deck.parse({
    lectureId: parsed.lecture_id,
    lectureTitle: parsed.lecture_title,
    mediaType: parsed.media_type,
    content: parsed.content,
  });
};

export const readSlideImage = (
  db: Database,
  lectureId: LectureId,
  slideNo: SlideNo,
): SlideImage | undefined => {
  const row: unknown = db
    .prepare(
      'select slide_no, media_type, content from slide_images where lecture_id = ? and slide_no = ?',
    )
    .get(lectureId, slideNo);
  return row === undefined ? undefined : imageFromRow(row);
};

/** The lecture's slide images, by slide number. */
export const readSlideImages = (db: Database, lectureId: LectureId): readonly SlideImage[] =>
  db
    .prepare(
      'select slide_no, media_type, content from slide_images where lecture_id = ? order by slide_no',
    )
    .all(lectureId)
    .map(imageFromRow);

/** Every lecture with a stored deck, in id order. */
export const storedLectureIds = (db: Database): readonly LectureId[] =>
  z
    .array(LectureId)
    .parse(db.prepare('select lecture_id from decks order by lecture_id').pluck().all());
