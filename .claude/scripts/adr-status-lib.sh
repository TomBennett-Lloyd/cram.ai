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
#   adr_status_lines <file>             one `<line number>\t<value>` per header Status line
#   adr_status_known <value>            0 when <value> is in the vocabulary, 1 otherwise
#   adr_status_rewrite <line> <value>   <line> with its value replaced, its markup kept
#
# Its harness is adr-status-lib.test.sh next door. Runs under bash 3.2.

# Group 1 is the label with its markup and the space after it; group 3 is the value.
ADR_STATUS_RE='^([[:space:]]*([-*+][[:space:]]+)?\**Status:\**[[:space:]]*)(.*)$'

adr_status_lines() { # adr_status_lines <file>
  local line value n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in
      '## '*) return 0 ;;
    esac
    if [[ $line =~ $ADR_STATUS_RE ]]; then
      value=${BASH_REMATCH[3]}
      printf '%s\t%s\n' "$n" "${value%"${value##*[![:space:]]}"}"
    fi
  done <"$1"
}

adr_status_known() { # adr_status_known <value>
  case "$1" in
    proposed | accepted | 'superseded by '[0-9][0-9][0-9][0-9]) return 0 ;;
  esac
  return 1
}

adr_status_rewrite() { # adr_status_rewrite <line> <value>
  [[ $1 =~ $ADR_STATUS_RE ]] || return 1
  printf '%s%s\n' "${BASH_REMATCH[1]}" "$2"
}
