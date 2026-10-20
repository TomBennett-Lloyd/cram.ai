#!/usr/bin/env bash
# Test harness for adr-status-lib.sh, its neighbour in this directory.
#
# A driver under TMP_ROOT sources the lib and calls the function its first argument names;
# `read <file>` prints what adr_status_read set, as `<count>\t<line number>\t<value>`, so a case
# asserts the whole reading exactly rather than by substring. Every markup arm of the Status
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
case "\$1" in
  read)
    adr_status_read "\$2" || exit
    printf '%s\\t%s\\t%s\\n' "\$ADR_STATUS_COUNT" "\$ADR_STATUS_LINE_NO" "\$ADR_STATUS_VALUE"
    ;;
  line)
    adr_status_read "\$2" || exit
    printf '%s\\n' "\$ADR_STATUS_LINE"
    ;;
  unreadable-set)
    chmod 200 "\$2"
    adr_status_set "\$2" "\$3"
    ;;
  unreadable-after-read)
    # The file goes unreadable between set's header read and its rewrite pass: the read is
    # taken here, and set's own call to it stubbed, so only the rewrite pass meets the mode.
    adr_status_read "\$2" || exit
    adr_status_read() { :; }
    chmod 200 "\$2"
    adr_status_set "\$2" "\$3"
    ;;
  *) "\$@" ;;
esac
EOF
ADR="$TMP_ROOT/0001-x.md"

reads() { # reads <expected stdout> [variant] — reads $ADR
  local expected="$1" interpreter
  for interpreter in $BASHES; do
    case_ctx="$interpreter${2:+, $2}"
    capture "$interpreter" "$DRIVER" read "$ADR"
    expect_rc 0 "$rc"
    [ "$out" = "$expected" ] || bad "read: expected [$expected], got [$out]"
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
  reads "$(printf '1\t3\taccepted')" "[$line]"
done
end

begin "the value is trimmed of trailing whitespace and kept whole otherwise"
header '- **Status:** superseded by 0007 	 ' >"$ADR"; reads "$(printf '1\t3\tsuperseded by 0007')"
header '- **Status:** draft, mostly' >"$ADR"; reads "$(printf '1\t3\tdraft, mostly')"
end

begin "a label with no value reads as an empty value, not as no line"
header '- **Status:**   ' >"$ADR"; reads "$(printf '1\t3\t')"
end

begin "lines that are not a Status label read nothing"
for line in '- **Statuses:** accepted' '- **Status** accepted' '-Status: accepted' \
  'x Status: accepted' '- **State:** accepted' '> Status: accepted'; do
  header "$line" >"$ADR"
  reads "$(printf '0\t\t')" "[$line]"
done
end

# ==========================================================================================
begin "only the header counts: the first '## ' heading ends it, a '### ' does not"
printf '# X\n\n## Context\n\n- **Status:** accepted\n' >"$ADR"; reads "$(printf '0\t\t')"
printf '# X\n\n### Aside\n- **Status:** accepted\n' >"$ADR"; reads "$(printf '1\t4\taccepted')"
printf '# X\n\n##Context\n- **Status:** accepted\n' >"$ADR"; reads "$(printf '1\t4\taccepted')"
end

begin "every header Status line is counted; the first is the one read"
printf '# X\n\n- **Status:** accepted\n* Status: proposed\n\n## Context\n- **Status:** draft\n' >"$ADR"
reads "$(printf '2\t3\taccepted')"
end

begin "the line is kept whole, markup and all, for the caller to quote and rewrite"
header '  * **Status:**  proposed ' >"$ADR"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$DRIVER" line "$ADR"
  [ "$out" = '  * **Status:**  proposed ' ] || bad "line: got [$out]"
done
case_ctx=""
end

begin "a last line with no newline is still read"
printf '# X\n\n- **Status:** proposed' >"$ADR"; reads "$(printf '1\t3\tproposed')"
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
begin "adr_status_set rewrites the read line's value in place and nothing else"
for interpreter in $BASHES; do
  for end_nl in yes no; do
    case_ctx="$interpreter, trailing newline $end_nl"
    body='# X\n\n  * **Status:**\t proposed  \n- **Date:** 2026-10-20\n\n## Context\n\n  * **Status:**\t proposed  '
    expected='# X\n\n  * **Status:**\t accepted\n- **Date:** 2026-10-20\n\n## Context\n\n  * **Status:**\t proposed  '
    [ "$end_nl" = yes ] && body="$body\n" expected="$expected\n"
    printf '%b' "$body" >"$ADR"
    chmod 640 "$ADR"
    printf '%b' "$expected" >"$TMP_ROOT/expected.md"
    capture "$interpreter" "$DRIVER" adr_status_set "$ADR" accepted
    expect_rc 0 "$rc"
    expect_silent
    cmp -s "$ADR" "$TMP_ROOT/expected.md" || bad "set: file reads [$(cat "$ADR")]"
    [ -n "$(find "$ADR" -perm 0640)" ] || bad "set: the file's mode changed from 0640"
  done
done
case_ctx=""
end

# Mode 200 does not stop root reading the file, so under root the case cannot be built.
begin "adr_status_set refuses a file it cannot read rather than writing it empty"
header '- **Status:** proposed' >"$ADR"
cp "$ADR" "$TMP_ROOT/before.md"
if [ "$(id -u)" -eq 0 ]; then
  printf 'SKIP unreadable-file case — running as root, which reads a mode-200 file\n'
  BASHES_UNREADABLE=""
else
  BASHES_UNREADABLE=$BASHES
fi
for interpreter in $BASHES_UNREADABLE; do
  for arm in unreadable-set unreadable-after-read; do
    case_ctx="$interpreter, $arm"
    chmod 600 "$ADR"
    capture "$interpreter" "$DRIVER" "$arm" "$ADR" accepted
    expect_rc 1 "$rc"
    chmod 600 "$ADR"
    cmp -s "$ADR" "$TMP_ROOT/before.md" || bad "set wrote [$(cat "$ADR")]"
  done
done
case_ctx=""
end

begin "adr_status_set refuses a file with no header Status line, and leaves it alone"
header '- **Date:** 2026-10-20' >"$ADR"
cp "$ADR" "$TMP_ROOT/before.md"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$DRIVER" adr_status_set "$ADR" accepted
  expect_rc 1 "$rc"
  cmp -s "$ADR" "$TMP_ROOT/before.md" || bad "set wrote [$(cat "$ADR")]"
done
case_ctx=""
end

finish
