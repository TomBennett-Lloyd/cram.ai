#!/usr/bin/env bash
#
# Harness for .claude/hooks/guard-dirty-revert.sh: one case per refuse arm and
# per pass arm, each run against a throwaway git repo whose tracked files are
# dirty or clean by name.
#
# Usage: bash .claude/scripts/guard-dirty-revert.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
HOOK=${GUARD_DIRTY_REVERT_HOOK:-$SCRIPTS/../hooks/guard-dirty-revert.sh}

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

REPO="$TMP_ROOT/repo"
PLAIN="$TMP_ROOT/plain"
DIRTY_FILES=(dirty.txt side sub/deep.txt 'with space.txt' 'q"t.txt' 'b\s.txt' 'hash#name.txt' -dash.txt x-y)

must git init -q -b main "$REPO"
must git -C "$REPO" config user.email "harness@example.invalid"
must git -C "$REPO" config user.name "Harness"
must git -C "$REPO" config commit.gpgsign false
must mkdir -p "$REPO/sub" "$PLAIN"
for f in "${DIRTY_FILES[@]}" clean.txt; do
  must cp /dev/null "$REPO/$f"
done
must git -C "$REPO" add -A
must git -C "$REPO" commit -q -m seed
must git -C "$REPO" branch side
for f in "${DIRTY_FILES[@]}"; do
  printf 'uncommitted\n' >"$REPO/$f" || exit 2
done
must cp /dev/null "$REPO/untracked.txt"

# CONF: conf.txt unmerged (UU) mid-merge, other.txt an ordinary dirty file beside it.
CONF="$TMP_ROOT/conf"
must git init -q -b main "$CONF"
must git -C "$CONF" config user.email "harness@example.invalid"
must git -C "$CONF" config user.name "Harness"
must git -C "$CONF" config commit.gpgsign false
printf 'base\n' >"$CONF/conf.txt" || exit 2
must cp /dev/null "$CONF/other.txt"
must git -C "$CONF" add -A
must git -C "$CONF" commit -q -m base
must git -C "$CONF" checkout -q -b theirs
printf 'theirs\n' >"$CONF/conf.txt" || exit 2
must git -C "$CONF" commit -q -am theirs
must git -C "$CONF" checkout -q main
printf 'ours\n' >"$CONF/conf.txt" || exit 2
must git -C "$CONF" commit -q -am ours
if git -C "$CONF" merge -q theirs >/dev/null 2>&1; then
  printf 'FATAL harness setup failed: the CONF merge did not conflict\n' >&2
  exit 2
fi
printf 'uncommitted\n' >"$CONF/other.txt" || exit 2

# event <cwd|-> <command> -> a Bash PreToolUse event at $TMP_ROOT/event.json; `-` omits cwd.
event() {
  must node -e '
    const [, cwd, command] = process.argv;
    const ev = { tool_name: "Bash", tool_input: { command } };
    if (cwd !== "-") ev.cwd = cwd;
    process.stdout.write(JSON.stringify(ev));
  ' "$1" "$2" >"$TMP_ROOT/event.json"
}

# refuses <command> <operand> [cwd] — exit 2, the operand and rule 8 on stderr, nothing on stdout.
refuses() {
  begin "refuses: $1"
  event "${3:-$REPO}" "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 2
  expect_stderr "  $2 (in "
  expect_stderr "docs/standards/testing.md rule 8"
  expect_stderr "a copy you set aside"
  [ -z "$out" ] || bad "expected no stdout; got: $out"
  end
}

# passes <command> [cwd] — exit 0, silent.
passes() {
  begin "passes: $1"
  event "${2:-$REPO}" "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 0
  expect_silent
  end
}

# --- checkout ----------------------------------------------------------------------------

refuses 'git checkout -- dirty.txt' dirty.txt
refuses 'git checkout dirty.txt' dirty.txt
refuses 'git checkout HEAD -- dirty.txt' dirty.txt
refuses 'git checkout side dirty.txt' dirty.txt
refuses 'git checkout side side' side
refuses 'git checkout .' .
refuses 'git checkout -- -dash.txt' -dash.txt
passes 'git checkout side'
passes 'git checkout -q side'
passes 'git checkout -b dirty.txt'
passes 'git checkout -B dirty.txt'
passes 'git checkout --orphan dirty.txt'
passes 'git checkout -- clean.txt'
passes 'git checkout -- untracked.txt'

# --- restore -----------------------------------------------------------------------------

refuses 'git restore dirty.txt' dirty.txt
refuses 'git restore -- dirty.txt' dirty.txt
refuses 'git restore --staged --worktree dirty.txt' dirty.txt
refuses 'git restore -SW dirty.txt' dirty.txt
refuses 'git restore -sHEAD dirty.txt' dirty.txt
refuses 'git restore --ours dirty.txt' dirty.txt
refuses 'git restore x-y' x-y
passes 'git restore --staged dirty.txt'
passes 'git restore -S dirty.txt'
passes 'git restore --source dirty.txt clean.txt'
passes 'git restore -Ws dirty.txt clean.txt'
passes 'git restore -S -sW dirty.txt'

# --- conflict resolution ------------------------------------------------------------------

passes 'git checkout --theirs conf.txt' "$CONF"
passes 'git restore --ours conf.txt' "$CONF"
refuses 'git checkout --theirs conf.txt other.txt' other.txt "$CONF"

# --- which tree -------------------------------------------------------------------------

refuses 'cd sub && git checkout -- deep.txt' deep.txt
refuses 'git -C sub checkout -- deep.txt' deep.txt
refuses 'git -c core.quotepath=off checkout -- dirty.txt' dirty.txt
refuses 'git --no-pager checkout -- dirty.txt' dirty.txt
refuses "cd $PLAIN && cd $REPO && git checkout -- dirty.txt" dirty.txt
passes "cd $PLAIN && git checkout -- dirty.txt"
passes 'git checkout -- dirty.txt' "$PLAIN"

begin "refuses: a bare cd goes to HOME"
event "$PLAIN" 'cd && git checkout -- dirty.txt'
HOME="$REPO" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

begin "refuses: an empty cwd in the event falls back to the hook's own working directory"
event '' 'git checkout -- dirty.txt'
capture -C "$REPO" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

begin "refuses: no cwd in the event falls back to the hook's own working directory"
event - 'git checkout -- dirty.txt'
capture -C "$REPO" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

# --- the command line --------------------------------------------------------------------

refuses 'true; git checkout -- dirty.txt' dirty.txt
refuses 'true & git checkout -- dirty.txt' dirty.txt
refuses 'true | git checkout -- dirty.txt' dirty.txt
refuses "echo \$(git checkout -- dirty.txt)" dirty.txt
refuses $'true\ngit checkout -- dirty.txt' dirty.txt
refuses $'git\tcheckout -- dirty.txt' dirty.txt
refuses $'git checkout -- \\\ndirty.txt' dirty.txt
refuses "git checkout -- 'with space.txt'" 'with space.txt'
refuses 'git checkout -- "with space.txt"' 'with space.txt'
refuses 'git checkout -- with\ space.txt' 'with space.txt'
refuses 'git checkout -- "q\"t.txt"' 'q"t.txt'
refuses 'git checkout -- "b\\s.txt"' 'b\s.txt'
refuses 'git checkout -- hash#name.txt' 'hash#name.txt'
refuses $'cat <<\'EOF\'\nbody\nEOF\ntrue\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<-EOF\n\tbody\n\tEOF\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<<x\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat << "EOF"\nbody\nEOF\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<EOF >/dev/null\nbody\nEOF\ngit checkout -- dirty.txt' dirty.txt
passes 'git commit -m "git checkout -- dirty.txt"'
passes $'git commit -m "$(cat <<\'EOF\'\n#1: drop the old advice "revert it (git checkout -- dirty.txt)"\nEOF\n)"'
passes $'git commit -m "$(cat <<\'EOF\'\n#1: a 6" ruler\ngit restore dirty.txt was the bad revert\nEOF\n)"'
refuses "echo \"\$(git checkout -- dirty.txt)\"" dirty.txt
refuses "git commit -m \"\$(echo x)\" && git checkout -- dirty.txt" dirty.txt
refuses "echo \"\$(true; (true); git checkout -- dirty.txt)\"" dirty.txt
passes "echo \"\$( (true) ) git checkout -- dirty.txt\""
refuses "echo \"\$(echo \$(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(cat <(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(tee >(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(echo \${b%(*})\" && git checkout -- dirty.txt" dirty.txt
refuses "echo \"\$(ls [(]*)\"; git restore dirty.txt" dirty.txt
passes "echo \"\$(echo \${x%(*}) git checkout -- dirty.txt\""
passes $'git commit -F - <<\'EOF\'\ngit checkout -- dirty.txt\nEOF'
passes '# git checkout -- dirty.txt'
passes 'true # ; git checkout -- dirty.txt'
passes 'echo checkout -- dirty.txt'
passes 'ls dirty.txt'

# --- cannot judge: exit 1, loud, never a refusal -----------------------------------------

must mkdir -p "$TMP_ROOT/bin"
printf '#!/usr/bin/env bash\nexit 3\n' >"$TMP_ROOT/bin/node-crash" || exit 2
must chmod +x "$TMP_ROOT/bin/node-crash"

begin "an event naming neither checkout nor restore never reaches the interpreter"
event "$REPO" 'ls dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "a crashing interpreter is exit 1 and says the call was not checked"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: $TMP_ROOT/bin/node-crash exited non-zero"
end

printf '#!/nonexistent/interpreter\n' >"$TMP_ROOT/bin/git-unspawnable" || exit 2
must chmod +x "$TMP_ROOT/bin/git-unspawnable"

begin "a git that resolves but cannot be spawned is exit 1, never a refusal"
event "$REPO" 'git checkout side'
HOOK_GIT_CMD="$TMP_ROOT/bin/git-unspawnable" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: could not run $TMP_ROOT/bin/git-unspawnable"
expect_not_stderr "refused"
expect_not_stderr "TypeError"
end

begin "a missing git is exit 1 and names the tool"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_GIT_CMD="$TMP_ROOT/bin/no-such-git" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: required tool not found: $TMP_ROOT/bin/no-such-git"
end

begin "a missing interpreter is exit 1 and names the tool"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/no-such-node" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: required tool not found: $TMP_ROOT/bin/no-such-node"
end

begin "an unparseable event that mentions checkout passes silently"
printf '{"tool_input": checkout' >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "an event with no command string that mentions checkout passes silently"
printf '{"tool_input": {"file_path": "checkout"}, "cwd": "%s"}' "$REPO" >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "the hook parses under every bash on the box"
expect_parses "$HOOK"
end

finish
