#!/usr/bin/env bash
# The workspace census shared by the shape gates in this directory: the `packages:`
# globs of `pnpm-workspace.yaml`, and the directories they name. Sourced, never
# executed.
#
# `pnpm-workspace.yaml` owns which directories are workspace members
# (docs/standards/architecture.md rule 9). The gates restated it as `apps` and
# `packages` until `eval` joined and fell outside all three of them (#80).
#
# The reader understands one shape and refuses everything else with status 2:
# a block-style `packages:` list whose entries are `<dir>` or `<dir>/*`, quoted or
# bare, where `<dir>` is one or more `/`-separated names. A negation, a `**`, a
# flow-style list or any other glob is refused, not approximated, because a gate
# that guessed its own census would report a pass over directories it never read.
# check-supply-chain-policy.sh reads the same file in bash and makes the same
# trade.
#
# Usage, from a gate:
#
#   # shellcheck source=./workspace-lib.sh
#   . "$SCRIPT_DIR/workspace-lib.sh"
#   workspace_read <gate name> "$ROOT" || exit 2
#
# which sets two arrays, both possibly empty:
#
#   WORKSPACE_PATTERNS  each `packages:` entry, unquoted, in file order
#   WORKSPACE_MEMBERS   each existing directory those entries name, relative to
#                       ROOT, in pattern order and then name order, each once
#
# Its harness is workspace-lib.test.sh next door.

WORKSPACE_MANIFEST=pnpm-workspace.yaml
WORKSPACE_PATTERNS=()
WORKSPACE_MEMBERS=()

_workspace_trim() { # _workspace_trim <string> -> the string without surrounding whitespace
  local s=$1
  s=${s#"${s%%[![:space:]]*}"}
  s=${s%"${s##*[![:space:]]}"}
  printf '%s' "$s"
}

_workspace_refuse() { # _workspace_refuse <caller> <message> -> status 2
  printf '%s: %s %s\n' "$1" "$WORKSPACE_MANIFEST" "$2" >&2
  return 2
}

_workspace_add_member() { # _workspace_add_member <relative dir>
  local seen
  for seen in ${WORKSPACE_MEMBERS[@]+"${WORKSPACE_MEMBERS[@]}"}; do
    [ "$seen" != "$1" ] || return 0
  done
  WORKSPACE_MEMBERS+=("$1")
}

workspace_read() { # workspace_read <caller> <root> -> sets WORKSPACE_PATTERNS, WORKSPACE_MEMBERS
  local caller=$1 root=$2 file line trimmed value body entry name
  local line_no=0 in_block=0 blocks=0
  file="$root/$WORKSPACE_MANIFEST"
  WORKSPACE_PATTERNS=()
  WORKSPACE_MEMBERS=()

  if [ ! -f "$file" ]; then
    _workspace_refuse "$caller" "is missing under $root — no workspace census to read"
    return 2
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    line=${line%$'\r'}
    trimmed=$(_workspace_trim "$line")

    case "$line" in
      packages:*)
        value=$(_workspace_trim "${line#packages:}")
        value=${value%%#*}
        if [ -n "$value" ] || [ "$blocks" -ne 0 ]; then
          _workspace_refuse "$caller" "line $line_no: expected one block-style 'packages:' key, got: $line"
          return 2
        fi
        blocks=1
        in_block=1
        continue
        ;;
    esac

    [ "$in_block" = 1 ] || continue
    case "$trimmed" in
      '' | '#'*) continue ;;
    esac
    case "$line" in
      [![:space:]]*)
        in_block=0
        continue
        ;;
    esac
    case "$trimmed" in
      '- '*) value=${trimmed#- } ;;
      *)
        _workspace_refuse "$caller" "line $line_no: not a '- <glob>' entry under packages: $trimmed"
        return 2
        ;;
    esac

    value=${value%%[[:space:]]#*}
    value=$(_workspace_trim "$value")
    case "$value" in
      \'*\') value=${value#\'} && value=${value%\'} ;;
      \"*\") value=${value#\"} && value=${value%\"} ;;
    esac

    body=${value%/\*}
    case "$body" in
      '' | /* | */ | *//* | *[!A-Za-z0-9._/-]*) body="" ;;
    esac
    case "/$body/" in
      */./* | */../*) body="" ;;
    esac
    if [ -z "$body" ]; then
      _workspace_refuse "$caller" "line $line_no: cannot expand packages entry '$value' — this reader knows <dir> and <dir>/* only"
      return 2
    fi
    WORKSPACE_PATTERNS+=("$value")
  done <"$file"

  if [ "$blocks" -eq 0 ] || [ ${#WORKSPACE_PATTERNS[@]} -eq 0 ]; then
    _workspace_refuse "$caller" "under $root declares no packages: entry"
    return 2
  fi

  for value in "${WORKSPACE_PATTERNS[@]}"; do
    body=${value%/\*}
    if [ "$body" = "$value" ]; then
      [ ! -d "$root/$body" ] || _workspace_add_member "$body"
      continue
    fi
    for entry in "$root/$body"/*; do
      [ -d "$entry" ] || continue
      name=${entry##*/}
      case "$name" in
        *$'\n'* | *$'\t'*)
          _workspace_refuse "$caller" "names a directory with a tab or newline in it under $body/"
          return 2
          ;;
      esac
      _workspace_add_member "$body/$name"
    done
  done
  return 0
}
