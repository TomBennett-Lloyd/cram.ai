#!/usr/bin/env bash
# Course-content gate: no tracked path is a slide or index binary, or lives under data/.
#
#   directory   any directory component named data
#   extension   any component ending .pdf .pptx .ppt .key .sqlite, or holding .sqlite-
#
# CLAUDE.md § Hard constraints: the repo never contains real course material. The
# course-content block in .gitignore is the floor that keeps these paths out of `git add`;
# this gate is the rule, and check-no-course-content.test.sh's parity case fails if the
# floor names a pattern the gate does not flag.
#
# Components, not basenames, so a Keynote bundle (deck.key/Index.zip) is caught; matched
# case-insensitively, because .gitignore is case-sensitive on a Linux checkout and
# LECTURE.PDF passes the floor there.
#
# The census is the index (`git ls-files`), so a `git add -f` fails before it is committed
# and CI checks exactly what HEAD holds. An empty index passes: absence of the checked
# surface is a pass, the bootstrap rule the sibling check-*.sh gates state.
#
# No dependencies: bash (3.2, which macOS ships as /bin/bash) and git.
#
# Usage: bash .claude/scripts/check-no-course-content.sh [REPO_ROOT]
#        (or `pnpm check:no-course-content`)
#        REPO_ROOT defaults to the repo root above this script; the argument
#        exists so the test harness can point the gate at throwaway repos.
# Exit:  0 nothing banned is tracked, 1 at least one path is, 2 the invocation was wrong.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
ROOT=${1:-"$SCRIPT_DIR/../.."}

if [ ! -d "$ROOT" ]; then
  printf 'check-no-course-content: not a directory: %s\n' "$ROOT" >&2
  exit 2
fi

# The whole index, even when REPO_ROOT names a subdirectory of the work tree.
if ! TOP=$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null) || [ -z "$TOP" ]; then
  printf 'check-no-course-content: not a git work tree: %s\n' "$ROOT" >&2
  exit 2
fi

BANNED_DIR=data
BANNED_EXTENSIONS="pdf pptx ppt key sqlite"

ext_alternation=${BANNED_EXTENSIONS// /|}
BANNED_RE="(^|/)$BANNED_DIR/|\\.($ext_alternation)(/|\$)|\\.sqlite-[^/]*(/|\$)"

tmp=$(mktemp) || exit 2
trap 'rm -f "$tmp"' EXIT INT TERM

# -z: names arrive verbatim, never octal-escaped or quoted.
if ! git -C "$TOP" ls-files -z >"$tmp"; then
  printf 'check-no-course-content: git ls-files failed in %s\n' "$TOP" >&2
  exit 2
fi

shopt -s nocasematch
tracked=0
offenders=()
while IFS= read -r -d '' path; do
  tracked=$((tracked + 1))
  if [[ $path =~ $BANNED_RE ]]; then
    offenders+=("$path")
  fi
done <"$tmp"

if [ ${#offenders[@]} -ne 0 ]; then
  printf '\ncheck-no-course-content: %d tracked path(s) that may hold course material\n' \
    "${#offenders[@]}" >&2
  for offender in "${offenders[@]}"; do
    printf '  ERROR %s\n' "$offender" >&2
  done
  printf '\nThe repo never contains real course material (CLAUDE.md § Hard constraints).\n' >&2
  printf 'Untrack it (git rm --cached <path>); fixtures are synthetic and authored as text.\n' >&2
  exit 1
fi

printf 'check-no-course-content: OK — no %s/ path or .{%s} file among %d tracked paths\n' \
  "$BANNED_DIR" "${BANNED_EXTENSIONS// /,}" "$tracked"
