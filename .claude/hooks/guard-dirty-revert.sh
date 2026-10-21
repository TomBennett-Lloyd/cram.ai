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
# The scan is lexical: the first word of each simple command after its `NAME=value`
# words, with `cd <dir>` and `git -C <dir>` followed, and into `"$(...)"` and `` `…` ``
# bodies. A command reached through an expansion, `xargs` or a shell keyword is not seen.
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

const [, fallbackDir, gitCmd] = process.argv;
let event;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);
let dir = typeof event.cwd === 'string' && event.cwd !== '' ? event.cwd : fallbackDir;

// Words after which a `case` or `esac` still stands at command position.
const LEADERS = new Set(['!', '{', 'if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time', 'coproc', 'function']);

// Appends each simple command's words to `commands`; a nested scan is a `"$(...)"` body
// and returns the index past the `)` that closes it: the first at paren depth 0 (#241)
// that does not end a `case` pattern (#268). A paren inside `[…]` counts, because the
// shells' own `$(` readers count it: zsh (the Bash tool's shell here) counts the `(` of
// `[(]`, and both bash and zsh close at the `)` of `[)]`.
function scan(src, i, commands, nested) {
  const heredocs = [];
  // Open parens, innermost last. Each holds the word and command it opened in (`$(`, `<(`,
  // `@(`, `a=(`, a subshell's empty one), which resume at its `)` without the group's text,
  // so zsh's `dirty.txt(N)` names dirty.txt. A `pattern` group is a zsh case pattern's (#287);
  // only a `command` group's words stand at command position (#288).
  const groups = [];
  // Open `case` frames, innermost last, each at the paren depth it opened at. `state` runs
  // head (`case WORD in`) → pattern → body, and back to pattern at each `;;`.
  const cases = [];
  let current = [];
  let word = null;
  commands.push(current);
  const frame = () => (cases.at(-1)?.depth === groups.length ? cases.at(-1) : undefined);
  // `sure` asks whether zsh surely runs the group as a command list, not only may (#288).
  const atCommand = (sure = false) =>
    (groups.at(-1)?.[sure ? 'sure' : 'command'] ?? true) &&
    current.every((w, k) => LEADERS.has(w) || current[k - 1] === 'function');
  const end = () => {
    if (word === null) return;
    const leading = atCommand();
    current.push(word);
    const f = frame();
    if (f?.state === 'head') {
      if (++f.words === 2) Object.assign(f, { state: 'pattern', fresh: true });
    } else if (f?.state === 'pattern') {
      if (f.fresh && word === 'esac') cases.pop();
      else f.fresh = false;
    } else if (leading && word === 'esac' && f) cases.pop();
    else if (leading && word === 'case') cases.push({ depth: groups.length, state: 'head', words: 0 });
    word = null;
  };
  const split = () => {
    end();
    current = [];
    commands.push(current);
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
    } else if (c === ';' && /[;&|]/.test(src[i + 1] ?? '') && frame()?.state === 'body') {
      split();
      Object.assign(frame(), { state: 'pattern', fresh: true });
      i += 2;
    } else if (c === '(') {
      const f = frame();
      // Only a `$(` opens a command group mid-pattern; `x(`, `@(` and `(` are glob groups (#287).
      const pattern = !word?.endsWith('$') && (f?.state === 'pattern' || groups.at(-1)?.pattern === true);
      // `((` is arithmetic only at command position; in an argument it is a glob group (#288).
      const leading = word === null && atCommand(true);
      // Where zsh may run a command, `((` may be arithmetic: read it so unless a quote in it would
      // end it elsewhere as a glob group, and scan its text as an argument too, for the `<(` a
      // glob group runs (#288).
      const ambiguous = word === null && !leading && (groups.at(-1)?.command ?? true);
      let unit = (leading || ambiguous) && !pattern && src[i + 1] === '(' ? arith(src, i + 2, commands) : -1;
      if (ambiguous && unit !== -1 && /['"]/.test(src.slice(i, unit))) unit = -1;
      else if (ambiguous && unit !== -1) {
        commands.push(ENTER_SUBSHELL);
        scan(`: ${src.slice(i + 2, unit - 2)}`, 0, commands, false);
        commands.push(LEAVE_SUBSHELL);
      }
      // The pattern is under way, so an `esac` after the group is part of it (#287).
      if (pattern && f) f.fresh = false;
      if (unit === -1) {
        // `$(`, `<(`, `>(`, `=(`, `{(` and a word-initial `(` open a command list, even in an
        // argument, where scanning one only refuses more (#288); any other `(` a glob group.
        const sure = !pattern && (leading || word === '=' || /[$<>]$/.test(word ?? ''));
        const command = !pattern && (word === null || word === '{' || word === '=' || /[$<>]$/.test(word));
        groups.push({ current, word, open: i, pattern, command, sure });
        word = null;
        current = [];
        commands.push(current);
        i++;
      } else {
        word = src.slice(i, unit);
        i = unit;
      }
    } else if (c === ')') {
      end();
      const f = frame();
      if (f?.state === 'pattern') {
        f.state = 'body';
        split();
      } else if (nested && groups.length === 0) return i + 1;
      else {
        const g = groups.pop();
        if (g) {
          current = g.current;
          word = g.word;
          if (frame()?.state === 'pattern' && endsPattern(src, i + 1)) {
            frame().state = 'body';
            split();
          } else if (g.pattern) {
            // The pattern word goes on past the group, so a `#` after it opens no comment (#287).
            word ??= '';
          } else if (src.slice(g.open + 1, i).trim() === '' && /^[A-Za-z_]\w*$/.test(word ?? current.at(-1) ?? '')) {
            // `NAME()` defines a function, so its body stands at command position (#287).
            split();
          }
        } else split();
      }
      i++;
    } else if (';&|'.includes(c)) {
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
      const quoted = dquote(src, i, commands);
      word = (word ?? '') + quoted.text;
      i = quoted.end;
    } else if (src.startsWith('$((', i)) {
      const unit = arith(src, i + 3, commands);
      word = (word ?? '') + (unit === -1 ? c : src.slice(i, unit));
      i = unit === -1 ? i + 1 : unit;
    } else if (src.startsWith('${', i)) {
      const j = param(src, i, commands, false);
      word = (word ?? '') + src.slice(i, j);
      i = j;
    } else if (src.startsWith("$'", i)) {
      const quoted = ansi(src, i);
      word = (word ?? '') + quoted.text;
      i = quoted.end;
    } else if (c === '`') {
      word ??= '';
      i = backtick(src, i, commands);
    } else if (c === '\\') {
      if (src[i + 1] !== '\n') word = (word ?? '') + (src[i + 1] ?? '');
      i += 2;
    } else {
      word = (word ?? '') + c;
      i++;
    }
  }
  end();
  return i;
}

// Whether the `)` before `i` ends a zsh case pattern: the character after it decides (#287).
function endsPattern(src, i) {
  if (src[i] !== ' ' && src[i] !== '\t') return src[i] === '\n' || src[i] === ';';
  while (src[i] === ' ' || src[i] === '\t') i++;
  return src[i] !== ')' && src[i] !== '|';
}

// Reads the `"…"` at `i`: returns its text and the index past the closing quote. A `$(`
// or backtick inside is scanned as a body; `\$` and `\``, like `\"` and `\\`, are escapes there.
function dquote(src, i, commands) {
  let text = '';
  i++;
  while (i < src.length && src[i] !== '"') {
    if (src.startsWith('$(', i)) {
      i = dollarParen(src, i, commands);
      continue;
    }
    if (src[i] === '`') {
      i = backtick(src, i, commands);
      continue;
    }
    if (src.startsWith('${', i)) {
      const j = param(src, i, commands, true);
      text += src.slice(i, j);
      i = j;
      continue;
    }
    if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] ?? '')) i++;
    text += src[i++];
  }
  return { text, end: i + 1 };
}

// Reads the `${…}` at `i` as one unit and returns the index past its first unquoted `}`.
// Its parens never reach the counter, but a `$(` or backtick inside is still scanned, so
// `${x:-$(git checkout …)}` is seen (#268). `'…'` quotes only outside `"…"` (`dq`), as zsh
// reads `"${x:-'}"`; a bare `{` does not nest, which is bash's reading and the shorter unit.
function param(src, i, commands, dq) {
  i += 2;
  while (i < src.length && src[i] !== '}') {
    if (src.startsWith('${', i)) i = param(src, i, commands, dq);
    else if (src.startsWith('$(', i)) i = dollarParen(src, i, commands);
    else if (src[i] === '`') i = backtick(src, i, commands);
    else if (src.startsWith("$'", i) && !dq) i = ansi(src, i).end;
    else if (src[i] === '"') i = dquote(src, i, commands).end;
    else if (src[i] === "'" && !dq) i = src.indexOf("'", i + 1) + 1 || src.length;
    else i += src[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

// Reads the `$(` at `i` as an arithmetic `$((…))` when it closes as one, else as a command body.
function dollarParen(src, i, commands) {
  const unit = src[i + 2] === '(' ? arith(src, i + 3, commands) : -1;
  return unit === -1 ? scan(src, i + 2, commands, true) : unit;
}

// Reads the arithmetic body at `i`, just past `$((` or `((`, as one unit: returns the index past
// its `))`, or `-1` when the `)` matching the inner `(` is not followed by `)`, which both shells
// then read as a command substitution or subshell. Its body quotes as `"…"` does, as zsh reads
// it (#288).
function arith(src, i, commands) {
  const before = commands.length;
  let depth = 1;
  let k = i;
  while (k < src.length) {
    if (src.startsWith('$(', k)) k = dollarParen(src, k, commands);
    else if (src.startsWith('${', k)) k = param(src, k, commands, true);
    else if (src[k] === '`') k = backtick(src, k, commands);
    else if (src[k] === '\\') k += 2;
    else if (src[k] === ')' && depth === 1) break;
    else depth += { '(': 1, ')': -1 }[src[k++]] ?? 0;
  }
  if (src[k + 1] === ')') return k + 2;
  commands.length = before;
  return -1;
}

const ANSI_ESCAPES = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};
const ANSI_ESCAPE = /\\(?:([0-7]{1,3})|x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|(.))/gs;

// Reads the `$'…'` at `i`: returns its decoded text and the index past the closing quote.
// An escaped quote never ends it; an unknown escape drops its backslash, as in zsh (#282).
function ansi(src, i) {
  let j = i + 2;
  while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
  const text = src.slice(i + 2, j).replace(ANSI_ESCAPE, (all, oct, x, u, U, other) => {
    if (other !== undefined) return ANSI_ESCAPES[other] ?? other;
    const cp = oct === undefined ? parseInt(x ?? u ?? U, 16) : parseInt(oct, 8);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
  });
  return { text, end: j + 1 };
}

// Bracket, in `commands`, the commands of a body the shell runs in a subshell, so a `cd` among
// them ends with the body. Markers rather than index ranges, so a rescan's truncation drops
// them with the commands they bracket (#282). `$(…)` and `(…)` bodies are not bracketed yet (#357).
const ENTER_SUBSHELL = Symbol('enter subshell');
const LEAVE_SUBSHELL = Symbol('leave subshell');

// Scans the `` `…` `` at `i` as a command body and returns the index past its closing backtick.
// The body is delimited before it is scanned, the shells' order, so a quote inside never holds
// the closing backtick (#282).
function backtick(src, i, commands) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
  commands.push(ENTER_SUBSHELL);
  scan(src.slice(i + 1, j).replace(/\\([$`\\])/g, '$1'), 0, commands, false);
  commands.push(LEAVE_SUBSHELL);
  return j + 1;
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

dirty=$(printf '%s' "$event" | "$HOOK_NODE_CMD" -e "$DIRTY_PROGRAM" "$PWD" "$HOOK_GIT_CMD") || {
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
