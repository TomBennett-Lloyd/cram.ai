#!/usr/bin/env bash
#
# Harness for .claude/hooks/guard-pgrep-loop.sh: one case per refused shape and per passed
# shape, each fed to the hook as a Bash PreToolUse event.
#
# Usage: bash .claude/scripts/guard-pgrep-loop.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
HOOK=${GUARD_PGREP_LOOP_HOOK:-$SCRIPTS/../hooks/guard-pgrep-loop.sh}

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

# event <command> -> a Bash PreToolUse event at $TMP_ROOT/event.json.
event() {
  must node -e '
    const ev = { tool_name: "Bash", tool_input: { command: process.argv[1] } };
    process.stdout.write(JSON.stringify(ev));
  ' "$1" >"$TMP_ROOT/event.json"
}

# refuses <command> — exit 2, the pgrep call and every alternative on stderr, nothing on stdout.
refuses() {
  begin "refuses: $1"
  event "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 2
  expect_stderr "refused"
  expect_stderr "  pgrep "
  expect_stderr "wait \$!"
  expect_stderr "kill -0"
  expect_stderr "pgrep -x <name>"
  expect_stderr "bracket form"
  expect_stderr "Monitor tool"
  expect_stderr "docs/standards/evidence.md"
  [ -z "$out" ] || bad "expected no stdout; got: $out"
  end
}

# passes <command> — exit 0, silent.
passes() {
  begin "passes: $1"
  event "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 0
  expect_silent
  end
}

# --- the shapes that hang: pgrep -f inside while/until ------------------------------------

refuses 'while pgrep -f vitest; do sleep 5; done'
refuses 'until ! pgrep -f vitest; do sleep 5; done'
refuses 'while ! pgrep -f vitest >/dev/null; do sleep 1; done'
refuses 'while true; do pgrep -f vitest || break; sleep 1; done'
refuses 'while true; do if pgrep -f vitest; then break; fi; done'
refuses $'while true\ndo\n  pgrep -f vitest && break\ndone'
refuses 'while sleep 1; do for i in 1 2; do pgrep -f x; done; done'
refuses 'for i in 1 2; do while pgrep -f x; do sleep 1; done; done'
refuses 'while { pgrep -f vitest; }; do sleep 1; done'
refuses 'while (pgrep -f vitest); do sleep 1; done'
refuses 'x=1 pgrep_wait=2; while pgrep -f vitest; do sleep 1; done'
refuses 'while /usr/bin/pgrep -f vitest; do sleep 1; done'
refuses 'while command pgrep -f vitest; do sleep 1; done'
refuses 'while pgrep -fl vitest; do sleep 1; done'
refuses 'while pgrep -lf vitest; do sleep 1; done'
refuses 'while pgrep -u tom -f vitest; do sleep 1; done'
refuses 'while pgrep -fu tom vitest; do sleep 1; done'
refuses 'while pgrep -f -i vitest; do sleep 1; done'
refuses 'while pgrep -f -- vitest; do sleep 1; done'
refuses 'while pgrep --full vitest; do sleep 1; done'
refuses 'while pgrep -f vitest | grep -q .; do sleep 1; done'
refuses 'while pgrep -f vitest; do sleep 1; done 2>&1'
refuses 'echo before; while pgrep -f vitest; do sleep 1; done; echo after'

# Each case below answers a mutant of the hook that the cases above let survive (#676).
refuses 'while true; do for i in 1; do :; done; pgrep -f vitest; break; done'
refuses 'while FOO=1 pgrep -f vitest; do sleep 1; done'
refuses 'while true; do LC_ALL=C pgrep -f vitest; done'
refuses 'while true; do pgrep -f -- -vitest; done'
refuses 'while pgrep -f -i "[V]ITEST"; do echo vitest; sleep 1; done'
refuses $'echo "$(true)"; while pgrep -f vitest; do sleep 1; done'
refuses $'cat <<-EOF\n\tbody\n\tEOF\nwhile pgrep -f vitest; do sleep 1; done'

# --- the #487 fixture, and the loop inside another shell ----------------------------------

refuses "zsh -c 'until ! pgrep -f 268-mut/mutate.py; do sleep 1; done'"
refuses "bash -c 'while pgrep -f vitest; do sleep 1; done'"
refuses "sh -ec 'while pgrep -f vitest; do sleep 1; done'"
refuses "bash -o pipefail -c 'while pgrep -f vitest; do sleep 1; done'"
refuses "eval 'while pgrep -f vitest; do sleep 1; done'"
refuses "zsh -c \"bash -c 'while pgrep -f vitest; do sleep 1; done'\""
refuses "while true; do bash -c 'pgrep -f vitest'; done"
refuses "(until ! pgrep -f vitest; do sleep 1; done) &"
refuses "nohup bash -c 'until ! pgrep -f vitest; do sleep 1; done' &"

# --- one-shot and bounded: harmless, passed -----------------------------------------------

passes 'pgrep -f vitest'
passes 'pgrep -fl vitest'
passes 'pgrep -f vitest | head -3'
passes 'while true; do sleep 1; done; pgrep -f vitest'
passes 'until false; do break; done && pgrep -f vitest'
passes 'for i in 1 2 3; do pgrep -f vitest; done'
passes 'while true; do for i in 1; do :; done; break; done; pgrep -f vitest'
passes "bash -c 'pgrep -f vitest'"
passes "bash -c 'for i in 1 2; do pgrep -f vitest; done'"
passes "bash -c 'while true; do break; done'; pgrep -f vitest"
passes "bash script.sh 'while pgrep -f vitest; do :; done'"
passes 'pgrep -f'
passes 'while pgrep; do sleep 1; done'

passes 'while pgrep vitest; do sleep 1; done'
passes 'while pgrep -f; do sleep 1; done'
passes "bash -c 'while true; do break'; pgrep -f vitest"
passes $'true # first; while pgrep -f vitest; do sleep 1; done\ntrue'
passes "while pgrep -u tom -f '[v]itest'; do sleep 1; done"
passes "while pgrep -fu tom '[v]itest'; do sleep 1; done"
passes "while pgrep --newest -f '[v]itest'; do sleep 1; done"

# --- the replacements: -x, the bracket form, pid polls ------------------------------------

passes 'while pgrep -x node; do sleep 1; done'
passes 'until ! pgrep -x node; do sleep 1; done'
passes 'while pgrep -fx "node vitest run"; do sleep 1; done'
passes "until ! pgrep -f '[v]itest'; do sleep 5; done"
passes 'until ! pgrep -f "[v]itest"; do sleep 5; done'
passes "zsh -c 'until ! pgrep -f \"[2]68-mut/mutate.py\"; do sleep 1; done'"
passes "while pgrep -f '^node.*[v]itest run'; do sleep 1; done"

# The bracket form holds only while the plain word is nowhere else in the call.
refuses "until ! pgrep -f '[v]itest'; do echo vitest is running; sleep 5; done"
refuses "until ! pgrep -f '[v]itest'; do sleep 5; done; echo vitest finished"
refuses "while pgrep -f '[v]itest|vitest'; do sleep 1; done"
refuses "while pgrep -f '[v]itest|[v'; do sleep 1; done"
passes "pgrep -f '[v]itest'; echo vitest"

# --- words are not commands: quotes, heredocs, comments -----------------------------------

passes 'echo "while pgrep -f vitest; do sleep 1; done"'
passes "echo 'until ! pgrep -f vitest; do sleep 1; done'"
passes 'git commit -m "#676: refuse while pgrep -f x; do :; done"'
passes $'cat <<\'EOF\'\nwhile pgrep -f vitest; do sleep 1; done\nEOF'
passes $'cat <<-EOF\n\twhile pgrep -f vitest; do sleep 1; done\n\tEOF'
passes $'gh issue comment 1 --body-file - <<\'EOF\'\nuntil ! pgrep -f x; do sleep 1; done\nEOF\npgrep -f x'
passes $'# while pgrep -f vitest; do sleep 1; done\ntrue'
passes 'true # while pgrep -f vitest; do sleep 1; done'
passes 'while true; do echo "pgrep -f vitest"; break; done'
passes 'while true; do echo pgrep; echo -f vitest; break; done'
passes $'while true; do\n  echo done\n  break\ndone\npgrep -f vitest'
passes "echo \$'while pgrep -f vitest; do :; done'"
passes 'echo while pgrep -f vitest'

# A heredoc ends the loop's text but not its structure: a command after it is still inside.
refuses $'while true; do cat <<EOF\nbody\nEOF\npgrep -f vitest; done'

# --- commands holding `$` or a backtick ----------------------------------------------------
# The rows are a quoted heredoc so that shellcheck does not read their `$` as unexpanded
# (SC2016): one `refuses|passes <command>` per line, the command as typed.
while read -r verdict row; do
  case $verdict in
    refuses) refuses "$row" ;;
    passes) passes "$row" ;;
    *)
      printf 'FATAL harness row has no verdict: %s %s\n' "$verdict" "$row" >&2
      exit 2
      ;;
  esac
done <<'ROWS'
refuses while [ -n "$(pgrep -f vitest)" ]; do sleep 1; done
refuses while [ -n "`pgrep -f vitest`" ]; do sleep 1; done
refuses until [ -z "$(echo $(pgrep -f vitest))" ]; do sleep 1; done
refuses while pgrep -f "$pattern"; do sleep 1; done
passes echo "$(pgrep -f vitest)"
passes while read -r pid; do echo "$pid"; done < <(pgrep -f vitest)
passes for i in $(pgrep -f vitest); do echo "$i"; done
passes while kill -0 "$pid" 2>/dev/null; do sleep 1; done
passes node long.mjs & pid=$!; wait $pid
ROWS

# --- cannot judge: exit 1, loud, never a refusal ------------------------------------------

must mkdir -p "$TMP_ROOT/bin"
printf '#!/usr/bin/env bash\nexit 3\n' >"$TMP_ROOT/bin/node-crash" || exit 2
must chmod +x "$TMP_ROOT/bin/node-crash"

begin "an event not naming pgrep never reaches the interpreter"
event 'while true; do sleep 1; done'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "a crashing interpreter is exit 1 and says the call was not checked"
event 'while pgrep -f vitest; do sleep 1; done'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-pgrep-loop: $TMP_ROOT/bin/node-crash exited non-zero"
expect_not_stderr "refused"
end

begin "a missing interpreter is exit 1 and names the tool"
event 'while pgrep -f vitest; do sleep 1; done'
HOOK_NODE_CMD="$TMP_ROOT/bin/no-such-node" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-pgrep-loop: required tool not found: $TMP_ROOT/bin/no-such-node"
end

begin "an unparseable event that mentions pgrep passes silently"
printf '{"tool_input": pgrep' >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "an event with no command string that mentions pgrep passes silently"
printf '{"tool_input": {"file_path": "pgrep"}}' >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "the hook parses under every bash on the box"
expect_parses "$HOOK"
end

finish
