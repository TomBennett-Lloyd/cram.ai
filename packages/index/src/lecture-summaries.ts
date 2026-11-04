import type { Database } from 'better-sqlite3';
import { LectureDigest, type LectureId, LectureSummary, type RetrievedSlide } from '@cram/shared';
import { z } from 'zod';

export const LECTURE_SUMMARY_TABLE_NAME = 'lecture_summaries';

/** One row per lecture whose last completed summary run kept or withheld a unit (`docs/adr/0009-explanation-answers.md` § Decision (l); #467). */
export const LECTURE_SUMMARY_TABLE = `
  create table ${LECTURE_SUMMARY_TABLE_NAME} (
    lecture_id text primary key references decks (lecture_id),
    units text not null,
    withheld text not null
  ) strict;
`;

export const SUMMARISED_LECTURES = `select lecture_id from ${LECTURE_SUMMARY_TABLE_NAME} where json_array_length(units) > 0`;

const DigestRow = z.object({ lecture_id: z.string(), units: z.string(), withheld: z.string() });

const digestOf = (row: unknown): LectureDigest => {
  const { lecture_id, units, withheld } = DigestRow.parse(row);
  const parsedUnits: unknown = JSON.parse(units);
  const parsedWithheld: unknown = JSON.parse(withheld);
  return LectureDigest.parse({
    lectureId: lecture_id,
    units: parsedUnits,
    withheld: parsedWithheld,
  });
};

export const dropSummary = (db: Database, lectureId: LectureId): void => {
  db.prepare(`delete from ${LECTURE_SUMMARY_TABLE_NAME} where lecture_id = ?`).run(lectureId);
};

/** `slides` is the lecture's; a unit citing any other slide is a caller bug and throws. An empty digest leaves no row. */
export const writeDigest = (
  db: Database,
  { lectureId, units, withheld }: LectureDigest,
  slides: readonly RetrievedSlide[],
): void => {
  const own = new Set(slides.map(({ sourceId }) => sourceId));
  const cited = [...units, ...withheld.map(({ unit }) => unit)].flatMap(
    ({ citations }) => citations,
  );
  for (const { sourceId } of cited) {
    if (!own.has(sourceId))
      throw new Error(`setDigest: ${sourceId} is not a slide of ${lectureId}`);
  }
  if (units.length === 0 && withheld.length === 0) {
    dropSummary(db, lectureId);
    return;
  }
  db.prepare(
    `insert into ${LECTURE_SUMMARY_TABLE_NAME} (lecture_id, units, withheld) values (?, ?, ?)
       on conflict (lecture_id) do update set units = excluded.units, withheld = excluded.withheld`,
  ).run(lectureId, JSON.stringify(units), JSON.stringify(withheld));
};

export const readSummary = (db: Database, lectureId: LectureId): LectureSummary | undefined => {
  const row: unknown = db
    .prepare(
      `select lecture_id, units, withheld from ${LECTURE_SUMMARY_TABLE_NAME} where lecture_id = ?`,
    )
    .get(lectureId);
  if (row === undefined) return undefined;
  const { units } = digestOf(row);
  return units.length === 0 ? undefined : LectureSummary.parse({ lectureId, units });
};

export const readDigests = (db: Database): readonly LectureDigest[] =>
  db
    .prepare(
      `select lecture_id, units, withheld from ${LECTURE_SUMMARY_TABLE_NAME} order by lecture_id`,
    )
    .all()
    .map(digestOf);
