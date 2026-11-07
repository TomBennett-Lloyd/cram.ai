#!/usr/bin/env bash
#
# The gate behind the `settings` tier of verify-tier.sh (#699): .claude/settings.json
# parses, and every hook it registers names a file that exists and is executable.
#
# A hook entry whose command points at nothing does not fail loudly. Claude Code runs
# it, the shell reports "No such file", and the guard the entry was added for is silently
# absent; PR #698 added one entry and nothing would have said so had the path been wrong.
#
# What is checked: each `command` under `hooks.<event>[].hooks[]`. The command must begin
# with $CLAUDE_PROJECT_DIR (bare, braced or double-quoted), because the project root is the
# only prefix this gate can resolve; its first word, with the variable replaced by the
# repository root, must be a regular file with the execute bit. Arguments after the first
# word are not inspected. A command in any other form is refused, not skipped: a path the
# gate cannot resolve is a path it cannot vouch for. So is a shape it cannot read: an event
# that is not an array, an entry with no hooks array, a command hook with no command string.
# Only a hook whose type names something else (a prompt hook) carries no command, and is
# passed over.
#
# An empty set of hook commands is refused. A settings file with no hooks is legitimate,
# but this repository's has them, and a parse that finds none has more likely misread the
# shape than found a file without any.
#
# Usage: bash .claude/scripts/check-settings-hooks.sh [REPO_ROOT]
#          REPO_ROOT defaults to the repository holding this script.
# Exit:  0 OK, 1 a check failed (each offending entry printed), 2 the invocation or the
#        environment was wrong (no node, no git, a missing root).
# The harness is check-settings-hooks.test.sh.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2

if [ $# -gt 1 ]; then
  printf 'check-settings-hooks: expected at most one directory, got: %s\n' "$*" >&2
  exit 2
fi
if [ $# -eq 1 ]; then
  [ -d "$1" ] || {
    printf 'check-settings-hooks: not a directory: %s\n' "$1" >&2
    exit 2
  }
  ROOT=$(cd "$1" && pwd -P) || exit 2
else
  ROOT=$(git -C "$SCRIPTS" rev-parse --show-toplevel) || exit 2
fi
command -v node >/dev/null 2>&1 || {
  printf 'check-settings-hooks: node is required to read the settings file\n' >&2
  exit 2
}

SETTINGS=".claude/settings.json"
if [ ! -f "$ROOT/$SETTINGS" ]; then
  printf 'check-settings-hooks: %s is missing under %s\n' "$SETTINGS" "$ROOT" >&2
  exit 1
fi

node - "$ROOT" "$SETTINGS" <<'JS'
const fs = require("fs");
const path = require("path");
const [root, settingsRel] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write("check-settings-hooks: " + message + "\n");
  process.exitCode = 1;
};
let settings;
try {
  settings = JSON.parse(fs.readFileSync(path.join(root, settingsRel), "utf8"));
} catch (error) {
  fail(settingsRel + " does not parse as JSON: " + error.message);
  process.exit();
}
const events = settings && typeof settings.hooks === "object" && settings.hooks !== null ? settings.hooks : {};
const PREFIX = /^(?:"\$CLAUDE_PROJECT_DIR"|"\$\{CLAUDE_PROJECT_DIR\}"|\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\})(\/\S*)/;
let seen = 0;
for (const [event, entries] of Object.entries(events)) {
  if (!Array.isArray(entries)) {
    fail(event + ": is not an array of hook entries");
    continue;
  }
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.hooks)) {
      fail(event + ": an entry has no hooks array");
      continue;
    }
    for (const hook of entry.hooks) {
      if (hook && typeof hook.type === "string" && hook.type !== "command") continue;
      if (!hook || typeof hook.command !== "string") {
        fail(event + ": a command hook has no command string");
        continue;
      }
      seen += 1;
      const match = PREFIX.exec(hook.command.trim());
      if (!match) {
        fail(event + ": cannot resolve a command not under $CLAUDE_PROJECT_DIR: " + hook.command);
        continue;
      }
      const file = path.join(root, match[1]);
      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        fail(event + ": hook file does not exist: " + match[1]);
        continue;
      }
      try {
        if (!stat.isFile()) throw new Error("not a file");
        fs.accessSync(file, fs.constants.X_OK);
      } catch {
        fail(event + ": hook is not an executable file: " + match[1]);
      }
    }
  }
}
if (seen === 0) fail(settingsRel + " registers no hook command, so the shape was misread or the hooks are gone");
if (process.exitCode !== 1) process.stdout.write("check-settings-hooks: OK — " + seen + " hook command(s) resolve under " + root + "\n");
JS
