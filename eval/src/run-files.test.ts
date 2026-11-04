import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVISIONAL_DEFAULT_PINS, type Recording } from '@cram/gateway';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scriptedReport } from './run-fixture';
import { readRun, RECORDINGS_DIR, recordingsText, REPORTS_DIR, writeRun } from './run-files';

const embedding = (text: string): Recording => ({
  role: 'embedder',
  pin: PROVISIONAL_DEFAULT_PINS.embedder,
  request: { texts: [text] },
  reply: { results: [{ status: 'embedded', vector: [text.length] }] },
});

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('recordingsText', () => {
  it('writes one recording per line in key order, whatever order they were made in', () => {
    const lines = recordingsText([embedding('bb'), embedding('a')]).split('\n');
    expect(lines.map((line) => line && (JSON.parse(line) as Recording).request)).toEqual([
      { texts: ['a'] },
      { texts: ['bb'] },
      '',
    ]);
  });
});

describe('writeRun and readRun', () => {
  it('read back the run written', async () => {
    const report = await scriptedReport('abc1234');
    const recordings = [embedding('a'), embedding('bb')];
    await writeRun(root, { report, recordings });
    expect(readRun(root)).toEqual({ status: 'read', run: { report, recordings } });
  });

  it('keep every report but only the newest run’s recordings', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    await writeRun(root, { report: await scriptedReport('def5678'), recordings: [] });
    expect(await readdir(join(root, REPORTS_DIR))).toEqual(['abc1234.json', 'def5678.json']);
    expect(await readdir(join(root, RECORDINGS_DIR))).toEqual(['def5678.jsonl']);
    expect(readRun(root)).toMatchObject({
      status: 'read',
      run: { report: { measuredCommit: 'def5678' } },
    });
  });
});

describe('writeRun', () => {
  it('removes only the older recordings files from the recordings directory', async () => {
    await mkdir(join(root, RECORDINGS_DIR));
    await writeFile(join(root, RECORDINGS_DIR, 'README.md'), '');
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    expect(await readdir(join(root, RECORDINGS_DIR))).toEqual(['README.md', 'abc1234.jsonl']);
  });
});

describe('readRun', () => {
  const recordingsAt = (name: string) => join(root, RECORDINGS_DIR, name);

  it('is invalid with no recordings directory', () => {
    expect(readRun(root)).toEqual({
      status: 'invalid',
      where: RECORDINGS_DIR,
      message: 'not found',
      reportIssues: [],
    });
  });

  it.each([[[]], [['a.jsonl', 'b.jsonl']]])(
    'is invalid unless exactly one run is recorded: %j',
    async (names) => {
      await mkdir(join(root, RECORDINGS_DIR));
      for (const name of names) await writeFile(recordingsAt(name), '');
      expect(readRun(root)).toMatchObject({ status: 'invalid', where: RECORDINGS_DIR });
    },
  );

  it('ignores a file that is not a recordings file', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    await writeFile(recordingsAt('README.md'), '');
    expect(readRun(root)).toMatchObject({ status: 'read' });
  });

  it('is invalid when the recordings have no report', async () => {
    await mkdir(join(root, RECORDINGS_DIR));
    await writeFile(recordingsAt('abc1234.jsonl'), '');
    expect(readRun(root)).toEqual({
      status: 'invalid',
      where: 'reports/abc1234.json',
      message: 'not found',
      reportIssues: [],
    });
  });

  it('is invalid when the report is not an EvalReport', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    await writeFile(join(root, 'reports/abc1234.json'), '{}');
    expect(readRun(root)).toMatchObject({ status: 'invalid', where: 'reports/abc1234.json' });
  });

  it('carries the schema issues of a report that is not an EvalReport', async () => {
    const report = await scriptedReport('abc1234');
    await writeRun(root, { report, recordings: [] });
    const lacking = JSON.stringify({ ...report, retrievalK: undefined });
    await writeFile(join(root, 'reports/abc1234.json'), lacking);
    expect(readRun(root)).toMatchObject({
      status: 'invalid',
      reportIssues: [{ code: 'invalid_type', path: ['retrievalK'] }],
    });
  });

  it('carries no schema issues for a recording that does not parse', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    await writeFile(recordingsAt('abc1234.jsonl'), '{}\n');
    expect(readRun(root)).toMatchObject({ status: 'invalid', reportIssues: [] });
  });

  it('is invalid when the report measured another commit than the recordings name', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [] });
    await rm(recordingsAt('abc1234.jsonl'));
    await writeFile(
      join(root, 'reports/def5678.json'),
      await readFile(join(root, 'reports/abc1234.json')),
    );
    await writeFile(recordingsAt('def5678.jsonl'), '');
    expect(readRun(root)).toEqual({
      status: 'invalid',
      where: 'reports/def5678.json',
      message: 'measured abc1234, not def5678',
      reportIssues: [],
    });
  });

  it('is invalid at the line of a recording that does not parse', async () => {
    await writeRun(root, { report: await scriptedReport('abc1234'), recordings: [embedding('a')] });
    await writeFile(recordingsAt('abc1234.jsonl'), `${recordingsText([embedding('a')])}{}\n`);
    expect(readRun(root)).toMatchObject({ status: 'invalid', where: 'recordings/abc1234.jsonl:2' });
  });
});
