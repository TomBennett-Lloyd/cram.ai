#!/usr/bin/env bash
#
# PreToolUse hook on Bash: refuses `bash .claude/scripts/<x>.sh` when the file the cwd-relative
# path resolves to is not the one on origin/main. The allow rules `Bash(bash .claude/scripts/<x>.sh:*)`
# in .claude/settings.json match that text, not a file, so they run whatever sits at the path in the
# cwd: a branch's edited copy, or a planted one, with no prompt (#687).
#
# Guarded set: every `Bash(bash .claude/scripts/<name>:*)` allow rule in the settings.json beside
# this hook, so a new rule is guarded the day it is added. A relative path that normalises to one of
# them is checked; an absolute path matches no rule and is left to the permission prompt.
#
# Checked: the script's bytes against `git show <ref>:.claude/scripts/<name>`, and every file it
# sources or runs as `"$script_dir/<file>"`, found in the reference blob and followed recursively,
# because a planted sibling library runs as freely as the script. The reference is read from this
# hook's own repository (refs are shared by every worktree), never from the tree being judged: a
# `git diff` there passes an untracked copy, and a planted repo carries its own origin/main.
#
# Exit 2 refuses the call. A missing tool or an unreadable event or settings.json is exit 1,
# non-blocking and loud, as hook-context.sh's header says: it is known before the event is read and
# would otherwise block every Bash call. Once an event does name a guarded script, a reference that
# cannot be read or a path that cannot be resolved ($VAR, a glob, a `cd` to a computed directory)
# is exit 2: failing open there is the hole this hook closes, and the cost is confined to those calls.
#
# The scan is lexical: simple commands split at `; & | ( ) newline`, backticks and `$(…)`, with
# `cd`, subshell and `bash -c '…'` scopes followed. A command reached through `eval`, `xargs` or a
# function is not seen, and a heredoc line spelling the command at command position is refused
# like the real one. The guarded script's own `pnpm verify` of a branch runs that branch's code by
# design and is not covered. Cases: .claude/scripts/guard-script-integrity.test.sh.
set -u
export PATH="/opt/homebrew/bin:$PATH"

hooks_dir=$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
lib="$hooks_dir/hook-context.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "guard-script-integrity: could not load $lib — allow-rule scripts were not checked for this call." >&2
  exit 1
fi

# Test seams, on the terms hook-context.sh gives HOOK_NODE_CMD.
: "${HOOK_GIT_CMD:=git}"
: "${GUARD_SCRIPT_REF:=origin/main}"
: "${GUARD_SCRIPT_REPO:=$hooks_dir}"
: "${GUARD_SCRIPT_SETTINGS:=$hooks_dir/../settings.json}"

hook_require_tools guard-script-integrity "$HOOK_NODE_CMD" "$HOOK_GIT_CMD" || exit 1

event=$(read_hook_event) || {
  echo "guard-script-integrity: could not read the hook event (stdin was unreadable) — allow-rule scripts were not checked for this call." >&2
  exit 1
}

case "$event" in
  *.claude/scripts/*) ;;
  *) exit 0 ;;
esac

# Prints one line per refusal reason; nothing when the call passes; exit 1 when settings.json
# cannot be read.
GUARD_PROGRAM=''
IFS= read -r -d '' GUARD_PROGRAM <<'NODE' || true
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [, fallbackDir, gitCmd, repoDir, ref, settingsFile] = process.argv;

let event;
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const command = event?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

let rules;
try {
  const allow = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))?.permissions?.allow ?? [];
  rules = allow.flatMap((r) => {
    const m = /^Bash\(bash (\.claude\/scripts\/[^\s*/]+):\*\)$/.exec(r);
    return m ? [m[1]] : [];
  });
} catch (e) {
  console.error(`guard-script-integrity: could not read ${settingsFile} (${e.message}) — allow-rule scripts were not checked for this call.`);
  process.exit(1);
}
if (rules.length === 0) process.exit(0);

const ENTER = Symbol('enter');
const LEAVE = Symbol('leave');

// Splits `src` into simple commands (`{ words: [{ text, dynamic }] }`) and ENTER/LEAVE markers
// bracketing the scopes a `cd` does not leave. A word is `dynamic` when it holds an expansion
// or a glob, whose value the scan cannot know.
function parse(src) {
  const items = [];
  let words = [];
  let word = null;
  let tick = false;
  const add = (ch, dynamic = false) => {
    word ??= { text: '', dynamic: false };
    word.text += ch;
    if (dynamic) word.dynamic = true;
  };
  const push = () => {
    if (word) words.push(word);
    word = null;
  };
  const flush = () => {
    push();
    if (words.length > 0) items.push({ words });
    words = [];
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' || c === ';' || c === '&' || c === '|') {
      flush();
      i++;
    } else if (c === '(') {
      flush();
      items.push(ENTER);
      i++;
    } else if (c === ')') {
      flush();
      items.push(LEAVE);
      i++;
    } else if (c === '`') {
      flush();
      items.push(tick ? LEAVE : ENTER);
      tick = !tick;
      i++;
    } else if (c === ' ' || c === '\t') {
      push();
      i++;
    } else if (c === '#' && word === null) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === "'") {
      word ??= { text: '', dynamic: false };
      i++;
      while (i < src.length && src[i] !== "'") word.text += src[i++];
      i++;
    } else if (c === '"') {
      word ??= { text: '', dynamic: false };
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] ?? '')) {
          word.text += src[i + 1];
          i += 2;
        } else if (src.startsWith('$(', i)) {
          let depth = 1;
          let j = i + 2;
          while (j < src.length && depth > 0) depth += { '(': 1, ')': -1 }[src[j++]] ?? 0;
          items.push(ENTER, ...parse(src.slice(i + 2, j - 1)), LEAVE);
          word.dynamic = true;
          word.text += src.slice(i, j);
          i = j;
        } else {
          if (src[i] === '$' || src[i] === '`') word.dynamic = true;
          word.text += src[i++];
        }
      }
      i++;
    } else if (c === '\\') {
      if (src[i + 1] !== '\n') add(src[i + 1] ?? '');
      i += 2;
    } else if (c === '~' && word === null && (src[i + 1] === '/' || src[i + 1] === undefined || /\s/.test(src[i + 1]))) {
      add(os.homedir());
      i++;
    } else {
      add(c, c === '$' || c === '*' || c === '?' || c === '[' || c === '~');
      i++;
    }
  }
  flush();
  return items;
}

const git = (...args) => spawnSync(gitCmd, ['-C', repoDir, ...args], { maxBuffer: 1 << 26 });
const refOk = git('rev-parse', '-q', '--verify', `${ref}^{commit}`);
const show = (rel) => {
  const run = git('show', `${ref}:${rel}`);
  return run.status === 0 ? run.stdout : null;
};

// The files a guarded script depends on, with their reference blobs: itself, then each
// `"$script_dir/<file>"` named by a blob already collected, recursively.
function closure(rel) {
  const blobs = new Map();
  const queue = [rel];
  while (queue.length > 0) {
    const next = queue.pop();
    if (blobs.has(next)) continue;
    const blob = show(next);
    blobs.set(next, blob);
    if (blob === null) continue;
    const code = blob.toString('utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const m of code.matchAll(/\$\{?script_dir\}?\/([A-Za-z0-9._-]+)/g)) queue.push(`${path.dirname(next)}/${m[1]}`);
  }
  return blobs;
}

const refused = [];

function check(word, dir, unknown) {
  const text = word.text;
  if (word.dynamic) {
    // A rule is a text prefix, so only a word that begins with a rule's path can match one.
    if (!rules.some((r) => path.normalize(text).startsWith(r))) return;
    refused.push(`${text}: cannot be resolved (it holds an expansion or a glob after the path), so it cannot be compared with ${ref}. Spell the path out.`);
    return;
  }
  if (path.isAbsolute(text)) return;
  const rel = path.normalize(text);
  if (!rules.includes(rel)) return;
  if (unknown) {
    refused.push(`${rel}: the working directory is not known (a cd to a computed path), so which file it names cannot be compared with ${ref}.`);
    return;
  }
  if (refOk.error || refOk.status !== 0) {
    refused.push(`${rel}: cannot be compared, ${ref} is not readable from ${repoDir} (${refOk.error?.code ?? `git exit ${refOk.status}`}).`);
    return;
  }
  const file = path.resolve(dir, rel);
  for (const [dep, blob] of closure(rel)) {
    const local = path.join(path.dirname(file), path.basename(dep));
    let bytes;
    try {
      bytes = fs.readFileSync(local);
    } catch {
      continue;
    }
    if (blob === null) refused.push(`${local}: ${dep} is not on ${ref}.`);
    else if (!bytes.equals(blob)) refused.push(`${local}: differs from ${ref}'s ${dep}.`);
  }
}

const RUNNERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'source', '.']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'builtin']);

function run(items, start) {
  let dir = start;
  let unknown = false;
  const stack = [];
  for (const item of items) {
    if (item === ENTER) {
      stack.push([dir, unknown]);
      continue;
    }
    if (item === LEAVE) {
      [dir, unknown] = stack.pop() ?? [dir, unknown];
      continue;
    }
    let words = item.words;
    while (words.length > 0 && (/^[A-Za-z_]\w*=/.test(words[0].text) || WRAPPERS.has(words[0].text))) words = words.slice(1);
    if (words.length === 0 || words[0].dynamic) continue;
    const head = words[0].text;
    const args = words.slice(1);
    if (head === 'cd' || head === 'pushd') {
      const target = args.find((w) => !w.text.startsWith('-') || w.text === '-');
      if (target === undefined) dir = os.homedir();
      else if (target.dynamic || target.text === '-') unknown = true;
      else dir = path.resolve(dir, target.text);
    } else if (head === 'popd') {
      unknown = true;
    } else if (RUNNERS.has(head)) {
      for (const [k, w] of args.entries()) {
        if (/^-[a-zA-Z]*c/.test(w.text) && args[k + 1] !== undefined) {
          run([ENTER, ...parse(args[k + 1].text), LEAVE], dir);
          break;
        }
        if (w.text.startsWith('-') && !w.dynamic) continue;
        check(w, dir, unknown);
        break;
      }
    }
  }
}

run(parse(command), typeof event.cwd === 'string' && event.cwd !== '' ? event.cwd : fallbackDir);
for (const reason of refused) console.log(`  ${reason}`);
NODE

refusals=$(printf '%s' "$event" | "$HOOK_NODE_CMD" -e "$GUARD_PROGRAM" "$PWD" "$HOOK_GIT_CMD" "$GUARD_SCRIPT_REPO" "$GUARD_SCRIPT_REF" "$GUARD_SCRIPT_SETTINGS") || {
  echo "guard-script-integrity: $HOOK_NODE_CMD exited non-zero — allow-rule scripts were not checked for this call." >&2
  exit 1
}
[ -z "$refusals" ] && exit 0

{
  echo "guard-script-integrity: refused — an allow rule would run this script with no prompt, but it is not origin/main's (#687):"
  printf '%s\n' "$refusals"
  echo "The rule matches the text 'bash .claude/scripts/<x>.sh', not a file, so it runs whatever the cwd holds there."
  echo "Run it from a tree whose .claude/scripts matches origin/main (the main checkout after a pull, or a branch"
  echo "after \`git merge origin/main\`), or give the script by absolute path: that matches no rule and is prompted."
} >&2
exit 2
