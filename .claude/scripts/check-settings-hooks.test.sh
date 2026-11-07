#!/usr/bin/env bash
# The fixtures write literal $CLAUDE_PROJECT_DIR into settings.json, so single quotes are the point.
# shellcheck disable=SC2016
# Test harness for check-settings-hooks.sh, its neighbour in this directory.
#
# Every fixture is a throwaway directory under the temp tree `harness_init_tmp` makes, holding
# a .claude/settings.json and the hook files it names, so the broken shapes are exercised for
# real without ever registering a dangling hook in this repository's own settings. One case
# runs the gate with NO argument against the real repository, because every other case pins
# the root to a fixture and the shipped default path could otherwise break unseen
# (testing.md rule 7).
#
# Usage: bash .claude/scripts/check-settings-hooks.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-settings-hooks.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

# hooks_fixture <name> <settings JSON> -> DIR holds .claude/settings.json and one executable
# hook, .claude/hooks/ok.sh, so a case only has to break what it is about.
hooks_fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/.claude/hooks"
  must printf '#!/bin/sh\nexit 0\n' >"$DIR/.claude/hooks/ok.sh"
  must chmod +x "$DIR/.claude/hooks/ok.sh"
  must printf '%s\n' "$2" >"$DIR/.claude/settings.json"
}

# settings_with <command> -> a settings document registering that one command.
settings_with() {
  printf '{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "%s" } ] } ] } }' "$1"
}

begin "check-settings-hooks.sh parses (bash -n)"
expect_parses "$CHECK"
end

begin "the real repository's settings pass, via the shipped default path"
capture bash "$CHECK"
expect_rc 0 "$rc"
expect_stdout "check-settings-hooks: OK"
end

begin "a quoted, a bare and a braced \$CLAUDE_PROJECT_DIR command all resolve"
hooks_fixture forms '{}'
must printf '%s\n' '{ "hooks": { "SessionStart": [ { "hooks": [
  { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/ok.sh" },
  { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/ok.sh --flag" },
  { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/ok.sh" } ] } ] } }' >"$DIR/.claude/settings.json"
capture bash "$CHECK" "$DIR"
expect_rc 0 "$rc"
expect_stdout "3 hook command(s) resolve"
end

# The positive control #699's acceptance names: a scratch entry pointing at a missing path.
begin "a hook entry naming a missing file is red, and the entry is named"
hooks_fixture missing "$(settings_with '\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/gone.sh')"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "hook file does not exist: /.claude/hooks/gone.sh"
expect_not_stdout "OK"
end

begin "a hook entry naming a file without the execute bit is red"
hooks_fixture not_exec "$(settings_with '\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/ok.sh')"
must chmod -x "$DIR/.claude/hooks/ok.sh"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "hook is not an executable file: /.claude/hooks/ok.sh"
end

begin "a hook entry naming a directory is red"
hooks_fixture dir_hook "$(settings_with '\"$CLAUDE_PROJECT_DIR\"/.claude/hooks')"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "hook is not an executable file"
end

begin "a command not under \$CLAUDE_PROJECT_DIR is refused, not skipped"
hooks_fixture elsewhere "$(settings_with '/usr/bin/true')"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "cannot resolve a command not under \$CLAUDE_PROJECT_DIR: /usr/bin/true"
end

begin "one bad entry among good ones fails the run and names only the bad one"
hooks_fixture one_bad '{}'
must printf '%s\n' '{ "hooks": { "PreToolUse": [ { "hooks": [
  { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/ok.sh" },
  { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gone.sh" } ] } ] } }' >"$DIR/.claude/settings.json"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "gone.sh"
expect_not_stderr "ok.sh"
end

begin "a settings file that does not parse is red"
hooks_fixture bad_json '{ "hooks": '
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "does not parse as JSON"
end

begin "a settings file registering no hook is red, not a free pass"
hooks_fixture no_hooks '{ "permissions": { "allow": [] } }'
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "registers no hook command"
end

begin "a missing settings file is red"
hooks_fixture no_file '{}'
must rm "$DIR/.claude/settings.json"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "is missing"
end

begin "a nonexistent root and a second argument exit 2"
capture bash "$CHECK" "$TMP_ROOT/nowhere"
expect_rc 2 "$rc"
expect_stderr "not a directory"
capture bash "$CHECK" "$TMP_ROOT" "$TMP_ROOT"
expect_rc 2 "$rc"
expect_stderr "at most one directory"
end

finish
