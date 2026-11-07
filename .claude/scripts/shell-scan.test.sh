#!/usr/bin/env bash
#
# Harness for .claude/hooks/shell-scan.cjs, the lexical scanner .claude/hooks/guard-dirty-revert.sh
# and .claude/hooks/guard-pgrep-loop.sh share (#692): one case per entry kind and per reading the guards lean on.
# Each guard's own harness covers the verdicts built on it.
#
# Usage: bash .claude/scripts/shell-scan.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SCANNER=${SHELL_SCAN_MODULE:-$SCRIPTS/../hooks/shell-scan.cjs}

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

# scans <command> <expected> — the entries `scan` returns, one JSON array: a command as its
# words, a subshell marker as "<enter>" or "<leave>", a heredoc as {"owner":[…],"body":"…"}.
scans() {
  begin "scans: $1"
  capture node -e '
    const { scan, ENTER_SUBSHELL, LEAVE_SUBSHELL } = require(process.argv[1]);
    const commands = [];
    scan(process.argv[2], 0, commands, false);
    const shown = commands
      .map((c) => (c === ENTER_SUBSHELL ? "<enter>" : c === LEAVE_SUBSHELL ? "<leave>" : c))
      .filter((c) => !Array.isArray(c) || c.length > 0);
    process.stdout.write(JSON.stringify(shown));
  ' "$SCANNER" "$1"
  expect_rc 0
  [ "$out" = "$2" ] || bad "expected $2; got: $out"
  end
}

# --- simple commands ------------------------------------------------------------------------

scans 'git checkout -- a.txt' '[["git","checkout","--","a.txt"]]'
scans 'a && b | c; d &' '[["a"],["b"],["c"],["d"]]'
scans "echo 'a b' \"c d\" e\\ f" '[["echo","a b","c d","e f"]]'
scans 'echo hi # git checkout x' '[["echo","hi"]]'
scans 'echo a#b' '[["echo","a#b"]]'

# --- bodies, one command and its entries per row: `$(…)`, backticks, `${…}`, arithmetic, `case` ---
# Rows are a quoted heredoc so shellcheck does not read their `$` as unexpanded (SC2016):
# `<command> => <expected>`.
while IFS= read -r row; do
  scans "${row%% => *}" "${row#* => }"
done <<'ROWS'
echo $(git restore x) y => [["echo","$","y"],["git","restore","x"]]
echo `git restore x` => [["echo",""],"<enter>",["git","restore","x"],"<leave>"]
echo ${x:- #}; pgrep -f v => [["echo","${x:- #}"],["pgrep","-f","v"]]
echo $(( 1 << 2 )); ls => [["echo","$(( 1 << 2 ))"],["ls"]]
case $x in a) ls;; esac => [["case","$x","in","a"],["ls"],["esac"]]
ROWS

# --- heredocs: one `{ owner, body }` entry, emitted at the newline that ends the reader's line ---------------------

scans $'cat <<EOF\nls\nEOF\npwd' '[["cat"],{"owner":["cat"],"body":"ls"},["pwd"]]'
scans $'while true; do bash <<SH\npgrep -f v\nSH\ndone' '[["while","true"],["do","bash"],{"owner":["do","bash"],"body":"pgrep -f v"},["done"]]'
scans $'cat <<-EOF\n\tx\n\tEOF\nls' '[["cat"],{"owner":["cat"],"body":"\tx"},["ls"]]'
scans $'cat <<\'EOF\' | wc\nx\nEOF' '[["cat"],["wc"],{"owner":["cat"],"body":"x"}]'
scans $'cat <<\\EOF\nx\nEOF' '[["cat"],{"owner":["cat"],"body":"x"}]'
scans $'(cat <<EOF)\nx\nEOF' '[["cat"],{"owner":["cat"],"body":"x"}]'
scans 'cat <<< word; ls' '[["cat","<<<","word"],["ls"]]'

# --- the loader guard: a scanner that cannot be read is exit 1 in both hooks ---------------------

for hook in guard-dirty-revert guard-pgrep-loop; do
  begin "$hook: an unreadable scanner is exit 1 and says the call was not checked"
  printf '%s' '{"tool_input":{"command":"git checkout -- a; pgrep x"}}' >"$TMP_ROOT/event.json" || exit 2
  HOOK_SHELL_SCAN="$TMP_ROOT/no-such-scanner.cjs" capture bash "$SCRIPTS/../hooks/$hook.sh" <"$TMP_ROOT/event.json"
  expect_rc 1
  expect_stderr "$hook: could not read the shell scanner $TMP_ROOT/no-such-scanner.cjs"
  expect_stderr "was not checked for this call"
  expect_not_stderr "refused"
  end
done

for hook in guard-dirty-revert guard-pgrep-loop; do
  begin "$hook: run by a relative path, it still loads the scanner"
  printf '%s' '{"tool_input":{"command":"while pgrep -f vitest; do sleep 1; done; git checkout -- a"}}' >"$TMP_ROOT/event.json" || exit 2
  must cd "$SCRIPTS/../.."
  capture bash ".claude/hooks/$hook.sh" <"$TMP_ROOT/event.json"
  must cd "$SCRIPTS"
  [ "$rc" != "1" ] || bad "exit 1: the hook could not judge: $err"
  expect_not_stderr "Cannot find module"
  end
done

begin "the module parses under node"
capture node --check "$SCANNER"
expect_rc 0
end

finish
