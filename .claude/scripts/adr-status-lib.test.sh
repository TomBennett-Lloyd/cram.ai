#!/usr/bin/env bash
# Test harness for adr-status-lib.sh, its neighbour in this directory.
#
# A driver under TMP_ROOT sources the lib and calls the function its first argument names, so
# a case asserts one function's whole stdout and exit code. Every markup arm of the Status
# grammar, the header bound, the trim, each vocabulary arm and the rewrite has a case, and each
# case runs under every bash in $BASHES (macOS ships 3.2 as /bin/bash).
#
# Usage: bash .claude/scripts/adr-status-lib.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
LIB="$SCRIPTS/adr-status-lib.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

DRIVER="$TMP_ROOT/driver.sh"
cat >"$DRIVER" <<EOF || exit 2
set -u
. "$LIB"
"\$@"
EOF
ADR="$TMP_ROOT/0001-x.md"

lines_of() { # lines_of <expected stdout> [variant] — reads $ADR
  local expected="$1" interpreter
  for interpreter in $BASHES; do
    case_ctx="$interpreter${2:+, $2}"
    capture "$interpreter" "$DRIVER" adr_status_lines "$ADR"
    expect_rc 0 "$rc"
    [ "$out" = "$expected" ] || bad "lines: expected [$expected], got [$out]"
    expect_not_out "unbound variable"
  done
  case_ctx=""
}

header() { # header <status line> -> an ADR whose header carries <status line> on line 3
  printf '# 0001 — X\n\n%s\n- **Date:** 2026-10-20\n\n## Context\n' "$1"
}

# ==========================================================================================
begin "adr-status-lib.sh parses (bash -n)"
expect_parses "$LIB"
end

# ==========================================================================================
begin "every markup the grammar admits reads the same value"
for line in '- **Status:** accepted' '* **Status:** accepted' '+ **Status:** accepted' \
  'Status: accepted' '**Status:** accepted' '- Status: accepted' '- **Status: accepted' \
  '- Status:** accepted' '  - **Status:** accepted' '-	**Status:**	accepted' \
  '-   **Status:** accepted'; do
  header "$line" >"$ADR"
  lines_of "$(printf '3\taccepted')" "[$line]"
done
end

begin "the value is trimmed of trailing whitespace and kept whole otherwise"
header '- **Status:** superseded by 0007 	 ' >"$ADR"; lines_of "$(printf '3\tsuperseded by 0007')"
header '- **Status:** draft, mostly' >"$ADR"; lines_of "$(printf '3\tdraft, mostly')"
end

begin "a label with no value reads as an empty value, not as no line"
header '- **Status:**   ' >"$ADR"; lines_of "$(printf '3\t')"
end

begin "lines that are not a Status label read nothing"
for line in '- **Statuses:** accepted' '- **Status** accepted' '-Status: accepted' \
  'x Status: accepted' '- **State:** accepted' '> Status: accepted'; do
  header "$line" >"$ADR"
  lines_of "" "[$line]"
done
end

# ==========================================================================================
begin "only the header counts: the first '## ' heading ends it, a '### ' does not"
printf '# X\n\n## Context\n\n- **Status:** accepted\n' >"$ADR"; lines_of ""
printf '# X\n\n### Aside\n- **Status:** accepted\n' >"$ADR"; lines_of "$(printf '4\taccepted')"
printf '# X\n\n##Context\n- **Status:** accepted\n' >"$ADR"; lines_of "$(printf '4\taccepted')"
end

begin "every header Status line is reported, with its line number"
printf '# X\n\n- **Status:** accepted\n* Status: proposed\n\n## Context\n- **Status:** draft\n' >"$ADR"
lines_of "$(printf '3\taccepted\n4\tproposed')"
end

begin "a last line with no newline is still read"
printf '# X\n\n- **Status:** proposed' >"$ADR"; lines_of "$(printf '3\tproposed')"
end

# ==========================================================================================
begin "adr_status_known admits the vocabulary and nothing near it"
for interpreter in $BASHES; do
  for value in proposed accepted 'superseded by 0007' 'superseded by 0000'; do
    case_ctx="$interpreter, [$value]"
    capture "$interpreter" "$DRIVER" adr_status_known "$value"
    expect_rc 0 "$rc"
  done
  for value in '' Accepted Proposed draft 'proposed | accepted' ' accepted' 'accepted ' \
    'xaccepted' 'acceptedx' 'superseded by 7' 'superseded by 007' 'superseded by 00070' \
    'superseded by NNNN' 'superseded by 0007 in part' 'superseded  by 0007' \
    'Superseded by 0007' 'superseded by 0O07' ' superseded by 0007'; do
    case_ctx="$interpreter, [$value]"
    capture "$interpreter" "$DRIVER" adr_status_known "$value"
    expect_rc 1 "$rc"
  done
done
case_ctx=""
end

# ==========================================================================================
begin "adr_status_rewrite replaces the value and keeps the label's markup"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$DRIVER" adr_status_rewrite '- **Status:** proposed' accepted
  expect_rc 0 "$rc"
  [ "$out" = '- **Status:** accepted' ] || bad "rewrite: got [$out]"
  capture "$interpreter" "$DRIVER" adr_status_rewrite '  * Status:	 proposed  ' accepted
  expect_rc 0 "$rc"
  [ "$out" = '  * Status:	 accepted' ] || bad "rewrite kept markup: got [$out]"
  capture "$interpreter" "$DRIVER" adr_status_rewrite '- **Date:** 2026-10-20' accepted
  expect_rc 1 "$rc"
  expect_silent
done
case_ctx=""
end

finish
