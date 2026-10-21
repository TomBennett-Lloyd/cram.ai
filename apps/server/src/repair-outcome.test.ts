import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '@cram/index';
import { CourseId } from '@cram/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { courseFilePath } from './data-directory';
import {
  BIO,
  markOlder,
  olderDataDir,
  repairedStatus,
  repairLog,
  RepinnedShortEmbedder,
  restarted,
  seededDataDir,
  stopRestarted,
} from './repair-fixture';
import { pdfDeck, settledStatus, startTestServer } from './server-fixture';

afterEach(stopRestarted);

describe('a start-up repair’s outcome', () => {
  it('titles a rebuilt lecture whose first slide reads no title by its stored title, verbatim', async () => {
    const dataDir = await olderDataDir('Cells/Tissues_1-2', await pdfDeck([[], ['Osmosis']]));
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'rebuilt' },
    ]);
    expect(await repairedStatus(server)).toMatchObject({
      stored: { lectures: [{ lectureId: 'l1', lectureTitle: 'Cells/Tissues_1-2' }] },
      repair: { state: 'done' },
    });
  });

  it('logs a stored deck that no longer reads by that outcome, and leaves the file as it was', async () => {
    const dataDir = await olderDataDir('The Hive', new TextEncoder().encode('not a PDF at all'));
    const before = readFileSync(courseFilePath(dataDir, BIO));
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'deck-unreadable' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: { state: 'course-unavailable', problem: 'older-schema' },
      repair: { state: 'failed' },
    });
    expect(readFileSync(courseFilePath(dataDir, BIO)).equals(before)).toBe(true);
  });

  it('fails, and logs as newer-schema, the repair of a file a newer version wrote', async () => {
    const dataDir = await seededDataDir();
    markOlder(dataDir, SCHEMA_VERSION + 1);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'newer-schema' },
    ]);
    expect(await repairedStatus(server)).toMatchObject({ repair: { state: 'failed' } });
  });

  it('fails, and logs as no-stored-decks, the repair of an older file that holds no decks', async () => {
    const dataDir = await seededDataDir();
    const db = new DatabaseSync(courseFilePath(dataDir, BIO));
    db.exec('drop table slide_images; drop table decks');
    db.close();
    markOlder(dataDir);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'no-stored-decks' },
    ]);
    expect(await repairedStatus(server)).toMatchObject({ repair: { state: 'failed' } });
  });

  it('fails the repair of a course file that holds another course', async () => {
    const dataDir = await seededDataDir();
    const chem = courseFilePath(dataDir, CourseId.parse('chem'));
    copyFileSync(courseFilePath(dataDir, BIO), chem);
    const server = await restarted(dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'chem', outcome: 'course-mismatch' },
    ]);
    expect((await settledStatus(server.server.port, 'chem')).json).toMatchObject({
      repair: { state: 'failed' },
    });
  });

  it('logs a repair that throws, and leaves the course unavailable', async () => {
    const dataDir = await seededDataDir();
    const server = await restarted(dataDir, new RepinnedShortEmbedder(3));
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'Error' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: { state: 'course-unavailable', problem: 'embedder-mismatch' },
      repair: { state: 'failed' },
    });
  });

  it('logs a course file it cannot repair by the reason it cannot be opened', async () => {
    const seeding = await startTestServer();
    await seeding.server.close();
    const path = courseFilePath(seeding.dataDir, BIO);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not a course file');
    const server = await restarted(seeding.dataDir);
    expect(await repairLog(server)).toEqual([
      { operation: 'repair', courseId: 'bio', outcome: 'not-a-course-file' },
    ]);
    expect(await repairedStatus(server)).toEqual({
      stored: { state: 'course-unavailable', problem: 'not-a-course-file' },
      repair: { state: 'failed' },
    });
  });
});
