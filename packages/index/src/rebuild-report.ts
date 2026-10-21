import type { Database } from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { DiscardedTable, type RebuildReport, RebuildReportRevision } from '@cram/shared';
import { z } from 'zod';

export const REBUILD_REPORT_TABLE_NAME = 'rebuild_report';

/** What rebuilds discarded, kept in the rebuilt file until the student dismisses it (#233). */
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

/** The report as the student is shown it; its revision hashes the rows `readRebuildReport` orders. */
export const rebuildReportOf = (db: Database): RebuildReport => {
  const discarded = readRebuildReport(db);
  if (discarded.length === 0) return { state: 'none' };
  const revision = createHash('sha256').update(JSON.stringify(discarded)).digest('hex');
  return {
    state: 'undismissed',
    discarded: [...discarded],
    revision: RebuildReportRevision.parse(revision),
  };
};

/** `report-changed` when the file holds an undismissed report other than `revision`'s, which stays. */
export type RebuildReportDismissal = 'dismissed' | 'report-changed';

export const dismissRebuildReport = (
  db: Database,
  revision: RebuildReportRevision,
): RebuildReportDismissal =>
  db.transaction((): RebuildReportDismissal => {
    const report = rebuildReportOf(db);
    if (report.state === 'undismissed' && report.revision !== revision) return 'report-changed';
    db.prepare(`delete from ${REBUILD_REPORT_TABLE_NAME}`).run();
    return 'dismissed';
  })();
