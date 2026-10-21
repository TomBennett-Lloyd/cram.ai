import { existsSync } from 'node:fs';
import { sourceIdOf } from '@cram/index';
import { StoredLectures, TopicTag } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  BIO,
  HIVE,
  HIVE_STORED,
  markOlder,
  openedUnder,
  repairedStatus,
  repairLog,
  RepinnedGatedEmbedder,
  restarted,
  seededDataDir,
  stopRestarted,
  uploadTo,
} from './repair-fixture';
import { pdfDeck, send, settledStatus, startTestServer, WordEmbedder } from './server-fixture';

afterEach(stopRestarted);

describe('start-up repair', () => {
  it('re-embeds a course file another embedder wrote, before any upload runs', async () => {
    const dataDir = await seededDataDir();
    const embedder = new RepinnedGatedEmbedder();
    const server = await restarted(dataDir, embedder);
    await uploadTo(server.server.port, await pdfDeck([['Drones', 'Drones are female.']]), 'l2');
    const held = await send(server.server.port, { method: 'GET', path: '/courses/bio/ingest' });
    expect(held.json).toMatchObject({
      stored: { state: 'course-unavailable', problem: 'embedder-mismatch' },
      repair: { state: 'running' },
      uploads: [{ lectureId: 'l2', progress: { state: 'queued' } }],
    });
    embedder.open();
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'reembedded' },
    ]);
    expect((await settledStatus(server.server.port, 'bio')).json).toMatchObject({
      stored: { state: 'read', lectures: [HIVE_STORED.lectures[0], { lectureId: 'l2' }] },
      repair: { state: 'done' },
      uploads: [{ progress: { state: 'indexed' } }],
    });
    expect(existsSync(`${courseFilePath(dataDir, BIO)}-wal`)).toBe(false);
  });

  it('reports a repair queued behind another course’s as queued', async () => {
    const seeding = await startTestServer();
    for (const courseId of ['bio', 'chem'])
      await uploadTo(seeding.server.port, await pdfDeck(HIVE), 'l1', 'hive.pdf', courseId);
    await settledStatus(seeding.server.port, 'chem');
    await seeding.server.close();
    const embedder = new RepinnedGatedEmbedder();
    const server = await restarted(seeding.dataDir, embedder);
    const repairs = await Promise.all(
      ['bio', 'chem'].map(
        async (courseId) =>
          (
            (await send(server.server.port, { method: 'GET', path: `/courses/${courseId}/ingest` }))
              .json as { repair: { state: string } }
          ).repair.state,
      ),
    );
    expect(repairs.sort()).toEqual(['queued', 'running']);
    embedder.open();
    for (const courseId of ['bio', 'chem'])
      expect((await settledStatus(server.server.port, courseId)).json).toMatchObject({
        repair: { state: 'done' },
      });
  });

  it('rebuilds an older course file from its stored decks', async () => {
    const dataDir = await seededDataDir(
      [[], ['Worker bees are male in this course.']],
      'hive.v2.pdf',
    );
    markOlder(dataDir);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'rebuilt' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: {
        state: 'read',
        lectures: [{ lectureId: 'l1', lectureTitle: 'hive.v2', slideCount: 2, imageOnly: [1] }],
        report: { state: 'none' },
      },
      repair: { state: 'done' },
    });
    const opened = await openedUnder(dataDir, new WordEmbedder());
    if (opened.status !== 'open') throw new Error(`course file: ${opened.status}`);
    expect(opened.course.slides().map(({ lectureTitle }) => lectureTitle)).toEqual([
      'hive.v2',
      'hive.v2',
    ]);
    opened.course.close();
  });

  it('rebuilds an older course file whose rows no rebuild carries over, and reports them until dismissed, across restarts', async () => {
    const dataDir = await seededDataDir();
    const seeded = await openedUnder(dataDir, new WordEmbedder());
    if (seeded.status !== 'open') throw new Error(`course file: ${seeded.status}`);
    const [first] = seeded.course.slides();
    if (first === undefined) throw new Error('seeded course has no slides');
    seeded.course.setTopics(sourceIdOf(first), [TopicTag.parse('castes')]);
    seeded.course.close();
    markOlder(dataDir);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'rebuilt' },
    ]);
    const reported = await repairedStatus(server);
    expect(reported).toMatchObject({
      stored: {
        ...HIVE_STORED,
        report: { state: 'undismissed', discarded: [{ table: 'topics', rows: 1 }] },
      },
      repair: { state: 'done' },
    });
    await server.server.close();
    const current = await restarted(dataDir);
    const shown = await repairedStatus(current);
    expect(shown).toEqual(reported);
    expect(current.logs).toEqual([]);
    const stored = StoredLectures.parse(shown.stored);
    if (stored.state !== 'read' || stored.report.state !== 'undismissed')
      throw new Error('expected an undismissed report');
    const { revision } = stored.report;
    const stale = await send(current.server.port, {
      method: 'DELETE',
      path: `/courses/bio/rebuild-report?revision=${'0'.repeat(64)}`,
    });
    expect(stale).toMatchObject({ status: 409, json: { status: 'report-changed' } });
    expect(await repairedStatus(current)).toEqual(shown);
    const dismissed = await send(current.server.port, {
      method: 'DELETE',
      path: `/courses/bio/rebuild-report?revision=${revision}`,
    });
    expect(dismissed).toMatchObject({ status: 200, json: { status: 'dismissed' } });
    expect(await repairedStatus(current)).toEqual({
      stored: HIVE_STORED,
      repair: { state: 'done' },
    });
    await current.server.close();
    expect(await repairedStatus(await restarted(dataDir))).toMatchObject({ stored: HIVE_STORED });
  });

  it('logs nothing for a course file that needs no repair, and leaves it closed', async () => {
    const dataDir = await seededDataDir();
    const server = await restarted(dataDir);
    await uploadTo(server.server.port, await pdfDeck([['Drones', 'Drones are female.']]), 'l2');
    expect((await settledStatus(server.server.port, 'bio')).json).toMatchObject({
      repair: { state: 'done' },
    });
    expect(server.logs).toEqual([]);
    expect(existsSync(`${courseFilePath(dataDir, BIO)}-wal`)).toBe(false);
  });
});
