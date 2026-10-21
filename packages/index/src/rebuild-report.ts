import type { Database } from 'better-sqlite3';
import { DiscardedTable } from '@cram/shared';
import { z } from 'zod';

export const REBUILD_REPORT_TABLE_NAME = 'rebuild_report';

/**
 * What rebuilds discarded, kept in the rebuilt file until the student dismisses it, so a restart
 * before they see it does not lose it (`docs/adr/0004-storage.md` § Decision (d); #233).
 */
export const REBUILD_REPORT_TABLE = `
  create table ${REBUILD_REPORT_TABLE_NAME} (
    table_name text primary key,
    rows integer not null check (rows > 0)
  ) strict;
`;

const ReportRow = z.object({ table_name: z.string(), rows: z.number() });

export const readRebuildReport = (db: Database): readonly DiscardedTable[] =>
  db
    .prepare(`select table_name, rows from ${REBUILD_REPORT_TABLE_NAME} order by table_name`)
    .all()
    .map((row) => {
      const { table_name, rows } = ReportRow.parse(row);
      return DiscardedTable.parse({ table: table_name, rows });
    });

/** Adds `discarded` to the report, summing the rows of a table it already names. */
export const recordRebuildReport = (db: Database, discarded: readonly DiscardedTable[]): void => {
  const add = db.prepare(
    `insert into ${REBUILD_REPORT_TABLE_NAME} (table_name, rows) values (?, ?)
       on conflict (table_name) do update set rows = rows + excluded.rows`,
  );
  db.transaction(() => {
    for (const { table, rows } of discarded) add.run(table, rows);
  })();
};

export const clearRebuildReport = (db: Database): void => {
  db.prepare(`delete from ${REBUILD_REPORT_TABLE_NAME}`).run();
};
