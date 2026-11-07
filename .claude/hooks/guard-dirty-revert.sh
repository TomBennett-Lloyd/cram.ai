#!/usr/bin/env bash
#
# PreToolUse hook on Bash: refuses `git checkout` / `git restore` with a path
# operand when that path has uncommitted changes, because the command discards
# every one of them, not only the mutant it was typed to undo — the revert
# docs/standards/testing.md rule 8 forbids, which two lanes made anyway (#229).
#
# Exit 2 refuses the call and hands stderr to the agent; exit 0 lets it run.
# Cannot judge (a missing tool, an unreadable event, an unspawnable git) is exit 1 — non-blocking and
# loud — never exit 2: this hook runs on every Bash call in every lane, so a
# refusing failure would block all of them (hook-context.sh's header).
#
# The scan is lexical and shared (shell-scan.cjs, which owns what it reads): the first word
# of each simple command after its `NAME=value` words, with `cd <dir>` and `git -C <dir>`
# followed, and into `"$(...)"` and `` `…` `` bodies. A command reached through an expansion,
# `xargs` or a shell keyword is not seen.
# Cases: .claude/scripts/guard-dirty-revert.test.sh.
set -u
export PATH="/opt/homebrew/bin:$PATH"

lib="$(dirname -- "${BASH_SOURCE[0]}")/hook-context.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "guard-dirty-revert: could not load $lib — git checkout/restore was not checked for this call." >&2
  exit 1
fi

# A test seam, on the terms hook-context.sh gives HOOK_NODE_CMD: the harness needs a
# git that resolves but cannot be spawned.
: "${HOOK_GIT_CMD:=git}"

hook_require_tools guard-dirty-revert "$HOOK_NODE_CMD" "$HOOK_GIT_CMD" || exit 1
hook_require_scanner guard-dirty-revert git checkout/restore || exit 1

event=$(read_hook_event) || {
  echo "guard-dirty-revert: could not read the hook event (stdin was unreadable) — git checkout/restore was not checked for this call." >&2
  exit 1
}

case "$event" in
  *checkout* | *restore*) ;;
  *) exit 0 ;;
esac

# Prints one `<operand> (in <dir>)` line per path operand with uncommitted
# changes; nothing for an unparseable event; exits 1 when git cannot be run. The
# leading positional of a `checkout` with no `--` is a path only when it does not
# resolve as a revision, which is how git itself reads it.
DIRTY_PROGRAM=''
IFS= read -r -d '' DIRTY_PROGRAM <<'NODE' || true
'use strict';
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const [, fallbackDir, gitCmd, scannerPath] = process.argv;
const { scan, ENTER_SUBSHELL, LEAVE_SUBSHELL } = require(scannerPath);
let event;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);
let dir = typeof event.cwd === 'string' && event.cwd !== '' ? event.cwd : fallbackDir;

function checkoutOperands(args) {
  if (args.some((a) => a === '-b' || a === '-B' || a === '--orphan')) return [];
  const dd = args.indexOf('--');
  if (dd !== -1) return args.slice(dd + 1).map((a) => ['path', a]);
  return args.filter((a) => !a.startsWith('-')).map((a, k) => [k === 0 ? 'first' : 'path', a]);
}

function restoreOperands(args) {
  let staged = false;
  let worktree = false;
  const operands = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--') {
      operands.push(...args.slice(k + 1));
      break;
    }
    if (a === '--staged') staged = true;
    else if (a === '--worktree') worktree = true;
    else if (a === '--source') k++;
    else if (/^-[^-]/.test(a)) {
      for (const [m, ch] of [...a.slice(1)].entries()) {
        if (ch === 'S') staged = true;
        if (ch === 'W') worktree = true;
        if (ch === 's') {
          if (m === a.length - 2) k++;
          break;
        }
      }
    } else operands.push(a);
  }
  return staged && !worktree ? [] : operands.map((a) => ['path', a]);
}

// A git that runs and fails (no such directory, not a work tree) prints nothing on
// stdout: nothing to judge. One that cannot be spawned cannot judge.
const git = (cwd, ...args) => {
  const run = spawnSync(gitCmd, ['-C', cwd, ...args], { encoding: 'utf8' });
  if (run.error) {
    console.error(`guard-dirty-revert: could not run ${gitCmd} (${run.error.code ?? run.error.message})`);
    process.exit(1);
  }
  return run;
};

const commands = [];
scan(command, 0, commands, false);
const outerDirs = [];
for (const simple of commands) {
  if (simple === ENTER_SUBSHELL) {
    outerDirs.push(dir);
    continue;
  }
  if (simple === LEAVE_SUBSHELL) {
    dir = outerDirs.pop();
    continue;
  }
  // A heredoc's body is not a command of this scan.
  if (!Array.isArray(simple)) continue;
  // `NAME=value` words, `NAME[sub]=value` among them (#288), lead a command without being it.
  let a = 0;
  while (a < simple.length && /^[A-Za-z_]\w*(\[.*\])?\+?=/.test(simple[a])) a++;
  const words = simple.slice(a);
  if (words[0] === 'cd') {
    dir = path.resolve(dir, words[1] ?? os.homedir());
    continue;
  }
  if (words[0] !== 'git') continue;
  let gitDir = dir;
  let k = 1;
  while (k < words.length && words[k].startsWith('-')) {
    if (words[k] === '-C') gitDir = path.resolve(gitDir, words[++k] ?? '');
    else if (words[k] === '-c') k++;
    k++;
  }
  const args = words.slice(k + 1);
  const operands =
    words[k] === 'checkout' ? checkoutOperands(args) : words[k] === 'restore' ? restoreOperands(args) : [];
  for (const [kind, operand] of operands) {
    if (kind === 'first' && git(gitDir, 'rev-parse', '-q', '--verify', operand).status === 0) continue;
    // An unmerged (`u `) entry is git's to guard: it refuses the plain forms there,
    // and `--ours`/`--theirs` on one is conflict resolution.
    const status = git(gitDir, 'status', '--porcelain=v2', '--untracked-files=no', '--', operand);
    if (status.stdout.split('\n').some((line) => line !== '' && !line.startsWith('u '))) {
      console.log(`  ${operand} (in ${gitDir})`);
    }
  }
}
NODE

dirty=$(printf '%s' "$event" | "$HOOK_NODE_CMD" -e "$DIRTY_PROGRAM" "$PWD" "$HOOK_GIT_CMD" "$HOOK_SHELL_SCAN") || {
  echo "guard-dirty-revert: $HOOK_NODE_CMD exited non-zero — git checkout/restore was not checked for this call." >&2
  exit 1
}
[ -z "$dirty" ] && exit 0

{
  echo "guard-dirty-revert: refused — this git checkout/restore discards EVERY uncommitted change in:"
  printf '%s\n' "$dirty"
  echo "not only a mutant (docs/standards/testing.md rule 8). Put the file back by the inverse of"
  echo "the edit you made, or from a copy you set aside before mutating."
} >&2
exit 2
