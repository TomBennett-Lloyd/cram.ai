#!/usr/bin/env bash
#
# PreToolUse hook on Bash: refuses a `pgrep -f <pattern>` inside a `while` or `until` loop when
# the pattern matches the text of the call itself. `-f` reads every process's whole command
# line, and a second shell running the same call holds that text, so two such waits never end:
# docs/standards/evidence.md § Host conventions rule 2 owns the reason and the replacements
# (owner decision 2026-11-07, #676).
#
# Refused: that call anywhere between a `while`/`until` and its `done`, the condition or the
# body. Passed: a one-shot `pgrep -f`, one in a `for` loop (bounded), `pgrep -x`, and a pattern
# that does not match the call's own text, the bracket form `'[v]itest'` among them. The
# bracket form is judged by that match, not by its shape: it fails when the plain word
# appears elsewhere in the same command. `-x` anchors the pattern to the whole line, so `-fx`
# is judged the same way, anchored.
#
# Exit 2 refuses the call and hands stderr to the agent; exit 0 lets it run. Cannot judge (a
# missing tool, an unreadable event) is exit 1 — non-blocking and loud — never exit 2: this
# hook runs on every Bash call in every lane (hook-context.sh's header).
#
# The scan is lexical and shared (shell-scan.cjs, which owns what it reads), with the script
# argument of `sh|bash|zsh|dash|ksh -c`, a heredoc fed to such a shell, and `eval` read as
# commands too. A pattern holding a variable expansion, or one that does not compile as a
# regular expression, cannot be judged and is refused.
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
hook_require_scanner guard-pgrep-loop pgrep -f || exit 1

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
const { scan } = require(path.resolve(process.argv[1]));

let event;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

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

// Whether the pattern finds the call's own text: unanchored for `-f`, over the whole line
// for `-fx`, where the call sits among other words as it does in a second shell's line.
function matchesOwnText(facts) {
  if (/\$[\w{@*#?!]/.test(facts.pattern)) return true;
  try {
    const flags = (facts.ignoreCase ? 'i' : '') + 's';
    return facts.exact
      ? new RegExp(`^(?:${facts.pattern})$`, flags).test(`sh -c ${command} x`)
      : new RegExp(facts.pattern, flags).test(command);
  } catch {
    return true;
  }
}

const refused = [];

// `stack` holds one boolean per open loop: true for `while`/`until`, false for a bounded one.
function analyse(commands, stack, depth) {
  for (const simple of commands) {
    // A subshell marker brackets nothing this analysis needs.
    if (typeof simple === 'symbol') continue;
    if (!Array.isArray(simple)) {
      // A heredoc fed to a shell without `-c` is the script it runs.
      const { owner, body } = simple;
      const head = owner.find((w) => !LEADERS.has(w) && !ASSIGNMENT.test(w) && !WRAPPERS.has(w) && w !== 'while' && w !== 'until');
      if (depth < 4 && head !== undefined && SHELLS.has(path.basename(head)) && !owner.some((a) => /^-[^-]*c/.test(a))) {
        const inner = [];
        scan(body, 0, inner, false);
        const open = stack.length;
        analyse(inner, stack, depth + 1);
        stack.length = open;
      }
      continue;
    }
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
      if (stack.includes(true) && facts.full && facts.pattern !== undefined && matchesOwnText(facts)) {
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

hits=$(printf '%s' "$event" | "$HOOK_NODE_CMD" -e "$LOOP_PROGRAM" "$HOOK_SHELL_SCAN") || {
  echo "guard-pgrep-loop: $HOOK_NODE_CMD exited non-zero — pgrep -f was not checked for this call." >&2
  exit 1
}
[ -z "$hits" ] && exit 0

{
  echo "guard-pgrep-loop: refused — pgrep -f inside a while/until loop, with a pattern that matches this command's own text:"
  printf '%s\n' "$hits"
  echo "(docs/standards/evidence.md § Host conventions rule 2). Instead:"
  echo "  - run the long command as a background tool call and take the harness's exit notice, or the Monitor tool;"
  echo "  - start it with '&', keep \$!, and 'wait \$!' or poll 'kill -0 <pid>';"
  echo "  - match by name with 'pgrep -x <name>', which does not read the command line;"
  echo "  - or write the pattern in bracket form, 'pgrep -f \"[v]itest\"', which passes only while the plain"
  echo "    word appears nowhere else in this command. A pattern holding a variable expansion, or one that"
  echo "    does not compile as a regular expression, cannot be judged and is refused too."
} >&2
exit 2
