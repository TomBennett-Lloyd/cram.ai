#!/usr/bin/env bash
# The ADR Status line, read and rewritten one way for every script that touches it:
# check-adr-index.sh, which gates it, and fill-verdict.sh, which flips it at merge (#115).
# Sourced, never executed.
#
# The vocabulary is `docs/adr/README.md`'s, under its **Status** bullet; its carriers are
# `.claude/ledgers/adr-status-vocabulary.ledger`.
#
# A Status line is one in the header — above the first `## ` heading — whose label is
# `Status:`, with or without a list marker (`-`, `*` or `+`) and emphasis on either side of
# it. The markup is the author's; the value after it is the vocabulary's.
#
# Usage, from a script:
#
#   # shellcheck source=./adr-status-lib.sh
#   . "$SCRIPT_DIR/adr-status-lib.sh"
#   adr_status_read <file>              sets ADR_STATUS_COUNT, the header's Status lines, and
#                                       for the first of them ADR_STATUS_LINE_NO, ADR_STATUS_LINE
#                                       and ADR_STATUS_VALUE (trailing whitespace trimmed)
#   adr_status_known <value>            0 when <value> is in the vocabulary, 1 otherwise
#   adr_status_set <file> <value>       reads <file>, then rewrites its first header Status line's
#                                       value in place, its markup and the rest of the file kept
#                                       byte for byte; 1, writing nothing, when it has none
#
# Its harness is adr-status-lib.test.sh next door. Runs under bash 3.2.

# Group 1 is the label with its markup and the space after it; group 3 is the value.
ADR_STATUS_RE='^([[:space:]]*([-*+][[:space:]]+)?\**Status:\**[[:space:]]*)(.*)$'

adr_status_read() { # adr_status_read <file>
  local line n=0
  ADR_STATUS_COUNT=0 ADR_STATUS_LINE_NO="" ADR_STATUS_LINE="" ADR_STATUS_VALUE=""
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in
      '## '*) return 0 ;;
    esac
    [[ $line =~ $ADR_STATUS_RE ]] || continue
    ADR_STATUS_COUNT=$((ADR_STATUS_COUNT + 1))
    [ "$ADR_STATUS_COUNT" = 1 ] || continue
    ADR_STATUS_LINE_NO=$n ADR_STATUS_LINE=$line ADR_STATUS_VALUE=${BASH_REMATCH[3]}
    ADR_STATUS_VALUE=${ADR_STATUS_VALUE%"${ADR_STATUS_VALUE##*[![:space:]]}"}
  done <"$1"
}

adr_status_known() { # adr_status_known <value>
  case "$1" in
    proposed | accepted | 'superseded by '[0-9][0-9][0-9][0-9]) return 0 ;;
  esac
  return 1
}

adr_status_set() { # adr_status_set <file> <value>
  local line n=0 body="" tail=0
  adr_status_read "$1"
  [[ $ADR_STATUS_LINE =~ $ADR_STATUS_RE ]] || return 1
  while IFS= read -r line || { [ -n "$line" ] && tail=1; }; do
    n=$((n + 1))
    [ "$n" = "$ADR_STATUS_LINE_NO" ] && line=${BASH_REMATCH[1]}$2
    body=$body$line
    [ "$tail" = 1 ] || body=$body$'\n'
  done <"$1" || return 1
  # Truncate-and-write, not a rename over the file, so the file keeps its mode.
  printf '%s' "$body" >"$1"
}
