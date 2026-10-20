import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Recording, recordingKey } from '@cram/gateway';
import { attempt } from './file-attempt';
import { parseJsonLines, parseJsonText } from './json-text';
import { EvalReport } from './report';

/** Under `eval/`: the reports kept as baselines, and the one run's recordings tier 1 replays (`docs/adr/0005-evaluation-as-gate.md` § Decision (e), (f)). */
export const REPORTS_DIR = 'reports';
export const RECORDINGS_DIR = 'recordings';

const RECORDINGS_SUFFIX = '.jsonl';
const reportFile = (commit: string): string => `${REPORTS_DIR}/${commit}.json`;
const recordingsFile = (commit: string): string =>
  `${RECORDINGS_DIR}/${commit}${RECORDINGS_SUFFIX}`;

/** One `Recording` per line, ordered by `recordingKey` so that a re-recording diffs call by call. */
export const recordingsText = (recordings: readonly Recording[]): string =>
  recordings
    .map((recording) => ({ key: recordingKey(recording), line: JSON.stringify(recording) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ line }) => `${line}\n`)
    .join('');

export interface EvalRun {
  readonly report: EvalReport;
  readonly recordings: readonly Recording[];
}

/** Writes the report and its recordings under `root`, removing any older run's recordings: their report stays. */
export const writeRun = async (root: string, run: EvalRun): Promise<void> => {
  const commit = run.report.measuredCommit;
  await mkdir(join(root, REPORTS_DIR), { recursive: true });
  await mkdir(join(root, RECORDINGS_DIR), { recursive: true });
  for (const name of await readdir(join(root, RECORDINGS_DIR)))
    if (name.endsWith(RECORDINGS_SUFFIX)) await rm(join(root, RECORDINGS_DIR, name));
  await writeFile(join(root, reportFile(commit)), `${JSON.stringify(run.report, null, 2)}\n`);
  await writeFile(join(root, recordingsFile(commit)), recordingsText(run.recordings));
};

export type EvalRunRead =
  | { readonly status: 'read'; readonly run: EvalRun }
  | { readonly status: 'invalid'; readonly where: string; readonly message: string };

const invalid = (where: string, message: string): EvalRunRead => ({
  status: 'invalid',
  where,
  message,
});

const readText = (root: string, path: string) =>
  attempt(() => readFileSync(join(root, path), 'utf8'));

/** The one recorded run under `root`, and the report it was recorded for. */
export const readRun = (root: string): EvalRunRead => {
  const listed = attempt(() => readdirSync(join(root, RECORDINGS_DIR)));
  if (!listed.ok) return invalid(RECORDINGS_DIR, 'not found');
  const names = listed.value.filter((name) => name.endsWith(RECORDINGS_SUFFIX));
  const [name, ...others] = names;
  if (name === undefined || others.length > 0)
    return invalid(RECORDINGS_DIR, `holds ${String(names.length)} recordings files, not one`);
  const commit = name.slice(0, -RECORDINGS_SUFFIX.length);
  const reportText = readText(root, reportFile(commit));
  if (!reportText.ok) return invalid(reportFile(commit), 'not found');
  const report = parseJsonText(reportText.value, EvalReport);
  if (!report.ok) return invalid(reportFile(commit), report.message);
  if (report.value.measuredCommit !== commit)
    return invalid(reportFile(commit), `measured ${report.value.measuredCommit}, not ${commit}`);
  const lines = readText(root, recordingsFile(commit));
  if (!lines.ok) return invalid(recordingsFile(commit), 'not found');
  const recordings = parseJsonLines(lines.value, Recording);
  if (recordings.status === 'invalid')
    return invalid(`${recordingsFile(commit)}:${String(recordings.line)}`, recordings.message);
  return { status: 'read', run: { report: report.value, recordings: recordings.items } };
};
