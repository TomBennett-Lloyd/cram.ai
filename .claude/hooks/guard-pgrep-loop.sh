#!/usr/bin/env bash
#
# PreToolUse hook on Bash: refuses a `pgrep -f <pattern>` that sits inside a `while` or
# `until` loop, the wait loop that never ends. `-f` matches the full command line of every
# process, the loop's own shell included, so `until ! pgrep -f vitest; do sleep 5; done`
# finds itself and waits for ever, and two such loops on one pattern find each other (the
# #268 lane ran 4 h 44 min past its merge; the #629 lane wrote the same loop after the prose
# rule landed, so the rule is enforced here: docs/standards/evidence.md § Host conventions
# rule 2, owner decision 2026-11-07, #676).
#
# Refused: `pgrep -f` with a pattern that matches this call's own text, anywhere between a
# `while`/`until` and its `done` (the condition or the body). Passed: a one-shot `pgrep -f`,
# `pgrep -x` (and `-fx`, whose whole-command-line match a longer line never equals), `pgrep -f`
# in a `for` loop (bounded), and the bracket form `'[v]itest'`, which does not match its own
# text. The bracket form is judged by that match, not by its shape: it fails when the plain
# word appears elsewhere in the same command, which the shell's own command line then holds.
#
# Exit 2 refuses the call and hands stderr to the agent; exit 0 lets it run. Cannot judge (a
# missing tool, an unreadable event) is exit 1 — non-blocking and loud — never exit 2: this
# hook runs on every Bash call in every lane (hook-context.sh's header).
#
# The scan is lexical, on the terms guard-dirty-revert.sh states, with the script argument of
# `sh|bash|zsh|dash|ksh -c` and `eval` read as commands too. A `pgrep` reached through a
# variable, `xargs` or a function defined in an earlier call is not seen. A `-f` pattern that
# holds a `$` cannot be judged and is refused.
# Cases: .claude/scripts/guard-pgrep-loop.test.sh.
set -u
export PATH="/opt/homebrew/bin:$PATH"

lib="$(dirname -- "${BASH_SOURCE[0]}")/hook-context.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "guard-pgrep-loop: could not load $lib — pgrep -f was not checked for this call." >&2
  exit 1
fi

hook_require_tools guard-pgrep-loop "$HOOK_NODE_CMD" || exit 1

event=$(read_hook_event) || {
  echo "guard-pgrep-loop: could not read the hook event (stdin was unreadable) — pgrep -f was not checked for this call." >&2
  exit 1
}

case "$event" in
  *pgrep*) ;;
  *) exit 0 ;;
esac

# Prints one `pgrep <args>` line per refused call; nothing for an unparseable event.
LOOP_PROGRAM=''
IFS= read -r -d '' LOOP_PROGRAM <<'NODE' || true
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let event;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

// Appends each simple command's words to `commands`. A `$(…)` or backtick body is scanned
// into the same list, after the command that holds it, so the list stays in execution order
// for the loop count. `nested` ends the scan at the `)` that closes a `$(`.
function scan(src, i, commands, nested) {
  const heredocs = [];
  let depth = 0;
  let current = [];
  let word = null;
  commands.push(current);
  const end = () => {
    if (word !== null) current.push(word);
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
    } else if (src.startsWith('$(', i)) {
      word ??= '';
      i = scan(src, i + 2, commands, true);
    } else if (c === '(') {
      split();
      depth++;
      i++;
    } else if (c === ')') {
      if (depth === 0 && nested) {
        end();
        return i + 1;
      }
      depth = Math.max(0, depth - 1);
      split();
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
      while (i < src.length && !/[\s;&|()]/.test(src[i])) {
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
        if (src.startsWith('$(', i)) i = scan(src, i + 2, commands, true);
        else if (src[i] === '`') i = backtick(src, i, commands);
        else if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] ?? '')) {
          word += src[i + 1];
          i += 2;
        } else word += src[i++];
      }
      i++;
    } else if (src.startsWith("$'", i)) {
      word ??= '';
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i++;
        word += src[i++] ?? '';
      }
      i++;
    } else if (src.startsWith('${', i)) {
      let level = 0;
      const from = i;
      do {
        if (src[i] === '{') level++;
        else if (src[i] === '}') level--;
        i++;
      } while (level > 0 && i < src.length);
      word = (word ?? '') + src.slice(from, i);
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

// Scans the `` `…` `` at `i` as a command body and returns the index past its closing backtick.
function backtick(src, i, commands) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
  scan(src.slice(i + 1, j).replace(/\\([$`\\])/g, '$1'), 0, commands, false);
  return j + 1;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
// `NAME=value` words, `NAME[sub]=value` among them, lead a command without being it.
const ASSIGNMENT = /^[A-Za-z_]\w*(\[.*\])?\+?=/;
const WRAPPERS = new Set(['command', 'exec', 'sudo', 'nohup', 'env', 'nice', 'builtin', 'time']);
const LEADERS = new Set(['!', '{', 'if', 'then', 'elif', 'else', 'do', 'time']);
// pgrep options whose argument is the next word (or the rest of the cluster).
const ARGUMENT_OPTIONS = 'FGPUdgtusMN';

// The `pgrep` arguments' verdict: whether `-f` is in force and the pattern it matches.
function pgrepFacts(args) {
  let full = false;
  let exact = false;
  let ignoreCase = false;
  let pattern;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === '--') {
      pattern ??= args[j + 1];
      break;
    }
    if (a === '--full') full = true;
    else if (a === '--exact') exact = true;
    else if (a === '--ignore-case') ignoreCase = true;
    else if (/^-[A-Za-z]/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        const ch = a[k];
        if (ch === 'f') full = true;
        else if (ch === 'x') exact = true;
        else if (ch === 'i') ignoreCase = true;
        if (ARGUMENT_OPTIONS.includes(ch)) {
          if (k === a.length - 1) j++;
          break;
        }
      }
    } else if (!a.startsWith('-') && pattern === undefined) pattern = a;
  }
  return { full, exact, ignoreCase, pattern };
}

// Whether the shell running this call would find its own command line with the pattern.
function matchesOwnText(facts) {
  if (/[$`]/.test(facts.pattern)) return true;
  try {
    return new RegExp(facts.pattern, facts.ignoreCase ? 'i' : '').test(command);
  } catch {
    return true;
  }
}

const refused = [];

// `stack` holds one boolean per open loop: true for `while`/`until`, false for a bounded one.
function analyse(commands, stack, depth) {
  for (const simple of commands) {
    let k = 0;
    let header = false;
    for (; k < simple.length && !header; k++) {
      const w = simple[k];
      if (w === 'while' || w === 'until') stack.push(true);
      else if (w === 'for' || w === 'select' || w === 'repeat') {
        stack.push(false);
        header = true;
      } else if (w === 'done') {
        stack.pop();
        header = true;
      } else if (!LEADERS.has(w) && !ASSIGNMENT.test(w)) break;
    }
    if (header) continue;
    while (k < simple.length && WRAPPERS.has(simple[k])) {
      k++;
      while (k < simple.length && ASSIGNMENT.test(simple[k])) k++;
    }
    if (k >= simple.length) continue;
    const name = path.basename(simple[k]);
    const args = simple.slice(k + 1);
    if (name === 'pgrep') {
      const facts = pgrepFacts(args);
      if (stack.includes(true) && facts.full && !facts.exact && facts.pattern !== undefined && matchesOwnText(facts)) {
        refused.push(`pgrep ${args.join(' ')}`);
      }
    } else if (depth < 4 && (SHELLS.has(name) || name === 'eval')) {
      let script;
      if (name === 'eval') script = args.join(' ');
      else {
        const flag = args.findIndex((a) => /^-[^-]*c/.test(a));
        script = flag === -1 ? undefined : args[flag + 1];
      }
      if (script === undefined) continue;
      const inner = [];
      scan(script, 0, inner, false);
      const open = stack.length;
      analyse(inner, stack, depth + 1);
      stack.length = open;
    }
  }
}

const commands = [];
scan(command, 0, commands, false);
analyse(commands, [], 0);
for (const line of refused) console.log(`  ${line}`);
NODE

hits=$(printf '%s' "$event" | "$HOOK_NODE_CMD" -e "$LOOP_PROGRAM") || {
  echo "guard-pgrep-loop: $HOOK_NODE_CMD exited non-zero — pgrep -f was not checked for this call." >&2
  exit 1
}
[ -z "$hits" ] && exit 0

{
  echo "guard-pgrep-loop: refused — pgrep -f inside a while/until loop matches the loop's own shell, so the wait never ends:"
  printf '%s\n' "$hits"
  echo "(docs/standards/evidence.md § Host conventions rule 2; #268 ran 4 h 44 min on this). Instead:"
  echo "  - run the long command as a background tool call and take the harness's exit notice, or the Monitor tool;"
  echo "  - start it with '&', keep \$!, and 'wait \$!' or poll 'kill -0 <pid>';"
  echo "  - match by name with 'pgrep -x <name>', which does not read the command line;"
  echo "  - or write the pattern in bracket form, 'pgrep -f \"[v]itest\"', which passes only while the plain"
  echo "    word appears nowhere else in this command."
} >&2
exit 2
