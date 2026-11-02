import type { Database } from 'better-sqlite3';
import { LectureSummary, type LectureId, type RetrievedSlide } from '@cram/shared';
import { z } from 'zod';

export const LECTURE_SUMMARY_TABLE_NAME = 'lecture_summaries';

/** One row per summarised lecture, its units as JSON (`docs/adr/0009-explanation-answers.md` § Decision (l)); no row is no summary. */
export const LECTURE_SUMMARY_TABLE = `
  create table ${LECTURE_SUMMARY_TABLE_NAME} (
    lecture_id text primary key references decks (lecture_id),
    units text not null
  ) strict;
`;

const SummaryRow = z.object({ lecture_id: z.string(), units: z.string() });

const summaryOf = (row: unknown): LectureSummary => {
  const { lecture_id, units } = SummaryRow.parse(row);
  const parsed: unknown = JSON.parse(units);
  return LectureSummary.parse({ lectureId: lecture_id, units: parsed });
};

/** `slides` is the lecture's; a summary citing any other slide is a caller bug and throws. */
export const writeSummary = (
  db: Database,
  { lectureId, units }: LectureSummary,
  slides: readonly RetrievedSlide[],
): void => {
  const own = new Set(slides.map(({ sourceId }) => sourceId));
  for (const { sourceId } of units.flatMap(({ citations }) => citations)) {
    if (!own.has(sourceId))
      throw new Error(`setSummary: ${sourceId} is not a slide of ${lectureId}`);
  }
  db.prepare(
    `insert into ${LECTURE_SUMMARY_TABLE_NAME} (lecture_id, units) values (?, ?)
       on conflict (lecture_id) do update set units = excluded.units`,
  ).run(lectureId, JSON.stringify(units));
};

export const dropSummary = (db: Database, lectureId: LectureId): void => {
  db.prepare(`delete from ${LECTURE_SUMMARY_TABLE_NAME} where lecture_id = ?`).run(lectureId);
};

export const readSummary = (db: Database, lectureId: LectureId): LectureSummary | undefined => {
  const row: unknown = db
    .prepare(`select lecture_id, units from ${LECTURE_SUMMARY_TABLE_NAME} where lecture_id = ?`)
    .get(lectureId);
  return row === undefined ? undefined : summaryOf(row);
};

export const readSummaries = (db: Database): readonly LectureSummary[] =>
  db
    .prepare(`select lecture_id, units from ${LECTURE_SUMMARY_TABLE_NAME} order by lecture_id`)
    .all()
    .map(summaryOf);
