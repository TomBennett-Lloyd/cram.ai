import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measuredCommit } from './measured-commit';

let dir = '';

const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cram-eval-134-'));
  git('init', '-q');
  await writeFile(join(dir, 'tracked.txt'), 'one\n');
  git('add', 'tracked.txt');
  git('commit', '-q', '--no-verify', '-m', 'one');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('measuredCommit', () => {
  it('is HEAD’s short SHA when every tracked file matches it', () => {
    expect(measuredCommit(dir)).toEqual({
      status: 'clean',
      commit: git('rev-parse', '--short', 'HEAD'),
    });
  });

  it('is dirty when a tracked file differs from HEAD, and names it', async () => {
    await writeFile(join(dir, 'tracked.txt'), 'two\n');
    expect(measuredCommit(dir)).toEqual({ status: 'dirty', changes: 'M tracked.txt' });
  });

  it('is dirty when a change is staged but not committed', async () => {
    await writeFile(join(dir, 'tracked.txt'), 'two\n');
    git('add', 'tracked.txt');
    expect(measuredCommit(dir)).toMatchObject({ status: 'dirty' });
  });

  it('is dirty when a file is not yet tracked, since a run may read it (a new lecture file)', async () => {
    await writeFile(join(dir, 'lecture-07.json'), '{}\n');
    expect(measuredCommit(dir)).toEqual({ status: 'dirty', changes: '?? lecture-07.json' });
  });

  it('ignores a file git ignores', async () => {
    await writeFile(join(dir, '.gitignore'), 'scratch\n');
    git('add', '.gitignore');
    git('commit', '-q', '--no-verify', '-m', 'ignore');
    await writeFile(join(dir, 'scratch'), 'x\n');
    expect(measuredCommit(dir)).toMatchObject({ status: 'clean' });
  });
});
