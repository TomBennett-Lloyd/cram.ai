import { execFileSync } from 'node:child_process';

export type MeasuredCommit =
  | { readonly status: 'clean'; readonly commit: string }
  | { readonly status: 'dirty'; readonly changes: string };

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

/** `HEAD` of the checkout holding `dir`, unless a file there differs from it or is not yet tracked: then no commit is what ran. */
export const measuredCommit = (dir: string): MeasuredCommit => {
  const changes = git(dir, 'status', '--porcelain');
  return changes === ''
    ? { status: 'clean', commit: git(dir, 'rev-parse', '--short', 'HEAD') }
    : { status: 'dirty', changes };
};
