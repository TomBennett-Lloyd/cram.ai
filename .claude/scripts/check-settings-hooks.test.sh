#!/usr/bin/env bash
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
# hook, .claude/hooks/ok.sh, so a case only has to break what it is about. In the JSON, @DIR@ and
# @BRACED@ stand for the literal $CLAUDE_PROJECT_DIR and ${CLAUDE_PROJECT_DIR}, so no fixture
# needs a single-quoted dollar.
hooks_fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/.claude/hooks"
  must printf '#!/bin/sh\nexit 0\n' >"$DIR/.claude/hooks/ok.sh"
  must chmod +x "$DIR/.claude/hooks/ok.sh"
  bare="\$CLAUDE_PROJECT_DIR" braced="\${CLAUDE_PROJECT_DIR}"
  doc="${2//@DIR@/$bare}"
  must printf '%s\n' "${doc//@BRACED@/$braced}" >"$DIR/.claude/settings.json"
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

begin "a quoted, a bare and a braced \$CLAUDE_PROJECT_DIR command, and a padded one, all resolve"
hooks_fixture forms '{ "hooks": { "SessionStart": [ { "hooks": [
  { "type": "command", "command": "\"@DIR@\"/.claude/hooks/ok.sh" },
  { "type": "command", "command": "@DIR@/.claude/hooks/ok.sh --flag" },
  { "type": "command", "command": "@BRACED@/.claude/hooks/ok.sh" },
  { "type": "command", "command": "\"@BRACED@\"/.claude/hooks/ok.sh" },
  { "type": "command", "command": "  @DIR@/.claude/hooks/ok.sh" } ] } ] } }'
capture bash "$CHECK" "$DIR"
expect_rc 0 "$rc"
expect_stdout "5 hook command(s) resolve"
end

# The positive control #699's acceptance names: a scratch entry pointing at a missing path.
begin "a hook entry naming a missing file is red, and the entry is named"
hooks_fixture missing "$(settings_with '\"@DIR@\"/.claude/hooks/gone.sh')"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "hook file does not exist: /.claude/hooks/gone.sh"
expect_not_stderr "not an executable"
expect_not_stdout "OK"
end

begin "a hook entry naming a file without the execute bit is red"
hooks_fixture not_exec "$(settings_with '\"@DIR@\"/.claude/hooks/ok.sh')"
must chmod -x "$DIR/.claude/hooks/ok.sh"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "hook is not an executable file: /.claude/hooks/ok.sh"
end

begin "a hook entry naming a directory is red"
hooks_fixture dir_hook "$(settings_with '\"@DIR@\"/.claude/hooks')"
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

# What the shell would run is the oracle: a variable that is not at the start, or no slash after
# it, is not a path under the project, whatever file the remainder happens to name.
begin "a command that merely contains \$CLAUDE_PROJECT_DIR later on is refused"
hooks_fixture interpreter_first "$(settings_with 'bash \"@DIR@\"/.claude/hooks/ok.sh')"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "cannot resolve a command not under \$CLAUDE_PROJECT_DIR"
end

begin "a variable with no slash after it is refused even when the joined name exists"
hooks_fixture no_slash "$(settings_with '\"@DIR@\"ok.sh')"
must cp "$DIR/.claude/hooks/ok.sh" "$DIR/ok.sh"
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "cannot resolve a command not under \$CLAUDE_PROJECT_DIR"
end

begin "a hook that is a symlink to an executable file resolves"
hooks_fixture symlinked "$(settings_with '\"@DIR@\"/.claude/hooks/link.sh')"
must ln -s ok.sh "$DIR/.claude/hooks/link.sh"
capture bash "$CHECK" "$DIR"
expect_rc 0 "$rc"
expect_stdout "1 hook command(s) resolve"
end

# A hook of a type that carries no command (a prompt hook) is not this gate's to resolve.
begin "a prompt hook is passed over, beside a command hook that resolves"
hooks_fixture prompt_hook '{ "hooks": { "Stop": [ { "hooks": [
  { "type": "prompt", "prompt": "check the work" },
  { "type": "command", "command": "@DIR@/.claude/hooks/ok.sh" } ] } ] } }'
capture bash "$CHECK" "$DIR"
expect_rc 0 "$rc"
expect_stdout "1 hook command(s) resolve"
end

begin "a command hook whose command is not a string is red, and so is one with none"
hooks_fixture no_command '{ "hooks": { "Stop": [ { "hooks": [
  { "type": "command", "command": 5 },
  { "type": "command" },
  { "command": "@DIR@/.claude/hooks/gone.sh" },
  { "type": "command", "command": "@DIR@/.claude/hooks/ok.sh" } ] } ] } }'
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "Stop: a command hook has no command string"
expect_stderr "hook file does not exist: /.claude/hooks/gone.sh"
end

begin "an event that is not an array, and an entry with no hooks array, are red"
hooks_fixture bad_shapes '{ "hooks": { "Stop": { "hooks": [] }, "PreToolUse": [ { "matcher": "Bash" } ],
  "SessionStart": [ { "hooks": [ { "type": "command", "command": "@DIR@/.claude/hooks/ok.sh" } ] } ] } }'
capture bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "Stop: is not an array of hook entries"
expect_stderr "PreToolUse: an entry has no hooks array"
end

begin "one bad entry among good ones fails the run and names only the bad one"
hooks_fixture one_bad '{ "hooks": { "PreToolUse": [ { "hooks": [
  { "type": "command", "command": "@DIR@/.claude/hooks/ok.sh" },
  { "type": "command", "command": "@DIR@/.claude/hooks/gone.sh" } ] } ] } }'
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
expect_not_stderr "registers no hook command"
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
