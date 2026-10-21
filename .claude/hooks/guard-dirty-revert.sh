#!/usr/bin/env bash
#
# PreToolUse hook on Bash: refuses `git checkout` / `git restore` with a path
# operand when that path has uncommitted changes, because the command discards
# every one of them, not only the mutant it was typed to undo — the revert
# docs/standards/testing.md rule 8 forbids, which two lanes made anyway (#229).
#
# Exit 2 refuses the call and hands stderr to the agent; exit 0 lets it run.
# Cannot judge (a missing tool, an unreadable event) is exit 1 — non-blocking and
# loud — never exit 2: this hook runs on every Bash call in every lane, so a
# refusing failure would block all of them (hook-context.sh's header).
#
# The scan is lexical: the first word of each simple command, with `cd <dir>` and
# `git -C <dir>` followed. A command inside a double-quoted `"$(...)"`, reached
# through a variable, `xargs` or a shell keyword is not seen.
# Cases: .claude/scripts/guard-dirty-revert.test.sh.
set -u
export PATH="/opt/homebrew/bin:$PATH"

lib="$(dirname -- "${BASH_SOURCE[0]}")/hook-context.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "guard-dirty-revert: could not load $lib — git checkout/restore was not checked for this call." >&2
  exit 1
fi

hook_require_tools guard-dirty-revert "$HOOK_NODE_CMD" git || exit 1

event=$(read_hook_event) || {
  echo "guard-dirty-revert: could not read the hook event (stdin was unreadable) — git checkout/restore was not checked for this call." >&2
  exit 1
}

case "$event" in
  *checkout* | *restore*) ;;
  *) exit 0 ;;
esac

# Prints one `<operand> (in <dir>)` line per path operand with uncommitted
# changes; nothing for an unparseable event. The leading positional of a
# `checkout` with no `--` is a path only when it does not resolve as a revision,
# which is how git itself reads it.
DIRTY_PROGRAM=''
IFS= read -r -d '' DIRTY_PROGRAM <<'NODE' || true
'use strict';
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

let event;
try {
  event = JSON.parse(process.argv[1]);
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);
let dir = typeof event.cwd === 'string' && event.cwd !== '' ? event.cwd : process.argv[2];

function tokenize(src) {
  const commands = [[]];
  const heredocs = [];
  let word = null;
  let i = 0;
  const end = () => {
    if (word !== null) commands[commands.length - 1].push(word);
    word = null;
  };
  const split = () => {
    end();
    commands.push([]);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      split();
      i++;
      for (const h of heredocs) {
        while (i < src.length) {
          let eol = src.indexOf('\n', i);
          if (eol === -1) eol = src.length;
          const line = src.slice(i, eol);
          i = eol + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        }
      }
      heredocs.length = 0;
    } else if (c === ' ' || c === '\t') {
      end();
      i++;
    } else if (c === '#' && word === null) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (';&|()'.includes(c)) {
      split();
      i++;
    } else if (src.startsWith('<<<', i)) {
      word = (word ?? '') + '<<<';
      i += 3;
    } else if (src.startsWith('<<', i)) {
      end();
      i += 2;
      const strip = src[i] === '-';
      if (strip) i++;
      while (src[i] === ' ') i++;
      let delim = '';
      while (i < src.length && !/\s/.test(src[i])) {
        if (src[i] === "'" || src[i] === '"') {
          const q = src[i++];
          while (i < src.length && src[i] !== q) delim += src[i++];
          i++;
        } else delim += src[i++];
      }
      heredocs.push({ delim, strip });
    } else if (c === "'") {
      word ??= '';
      i++;
      while (i < src.length && src[i] !== "'") word += src[i++];
      i++;
    } else if (c === '"') {
      word ??= '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\'.includes(src[i + 1] ?? '')) i++;
        word += src[i++];
      }
      i++;
    } else if (c === '\\') {
      if (src[i + 1] !== '\n') word = (word ?? '') + (src[i + 1] ?? '');
      i += 2;
    } else {
      word = (word ?? '') + c;
      i++;
    }
  }
  end();
  return commands;
}

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

// A git that fails (no such directory, not a work tree) prints nothing on stdout: nothing to judge.
const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

for (const words of tokenize(command)) {
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
    const status = git(gitDir, 'status', '--porcelain', '--untracked-files=no', '--', operand);
    if (status.stdout !== '') console.log(`  ${operand} (in ${gitDir})`);
  }
}
NODE

dirty=$("$HOOK_NODE_CMD" -e "$DIRTY_PROGRAM" "$event" "$PWD") || {
  echo "guard-dirty-revert: could not read the hook event ($HOOK_NODE_CMD failed) — git checkout/restore was not checked for this call." >&2
  exit 1
}
[ -z "$dirty" ] && exit 0

{
  echo "guard-dirty-revert: refused — this git checkout/restore discards EVERY uncommitted change in:"
  printf '%s\n' "$dirty"
  echo "not only a mutant (docs/standards/testing.md rule 8). Put the file back by the inverse of"
  echo "the edit you made, or from a copy you set aside before mutating. To drop the whole file's"
  echo "changes on purpose, \`git stash push -- <path>\` keeps them recoverable."
} >&2
exit 2
