#!/usr/bin/env bash
# Course-content gate: no tracked path is a slide or index binary, or lives under data/.
#
# CLAUDE.md § Hard constraints: the repo never contains real course material. The
# course-content block in .gitignore is the floor that keeps these paths out of `git add`;
# this gate is the rule, and check-no-course-content.test.sh's parity case fails if the
# floor bans a pattern the gate does not flag or re-includes one it does not exempt. Every
# copy of the banned set is listed in .claude/ledgers/course-content-patterns.ledger.
#
# Components, not basenames, so a Keynote bundle (deck.key/Index.zip) is caught; matched
# case-insensitively, because .gitignore is case-sensitive on a Linux checkout and
# LECTURE.PDF passes the floor there.
#
# The census is the index (`git ls-files`), so a `git add -f` fails before it is committed
# and CI checks exactly what HEAD holds. An empty index passes.
#
# THE ONE EXEMPTION (owner decision 2026-10-19, #31): a synthetic slide fixture for the
# ingest adapter tests (docs/standards/testing.md rule 3). It is a tracked path FIXTURE_RE
# matches, case-sensitively: no subdirectory, no dotted stem, and no other banned
# extension, data/ or .sqlite file is ever exempt. Each one also needs a provenance line in
# PROVENANCE_FILE, read from the index like the census, of the form
#
#     - `<file>`: authored with <tool> from <inputs>
#
# with <tool> and <inputs> non-empty, so a reviewer can tell a synthetic deck from a real
# one without opening it. A fixture without that line fails like any other banned path.
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

FIXTURE_DIR=packages/ingest/fixtures
FIXTURE_EXTENSIONS="pdf pptx"
PROVENANCE_FILE=$FIXTURE_DIR/README.md

FIXTURE_RE="^$FIXTURE_DIR/[A-Za-z0-9_-]+\\.(${FIXTURE_EXTENSIONS// /|})\$"

tmp=$(mktemp) || exit 2
trap 'rm -f "$tmp"' EXIT INT TERM

# -z: names arrive verbatim, never octal-escaped or quoted.
if ! git -C "$TOP" ls-files -z >"$tmp"; then
  printf 'check-no-course-content: git ls-files failed in %s\n' "$TOP" >&2
  exit 2
fi

shopt -s nocasematch
tracked=0
hits=()
while IFS= read -r -d '' path; do
  tracked=$((tracked + 1))
  if [[ $path =~ $BANNED_RE ]]; then
    hits+=("$path")
  fi
done <"$tmp"
shopt -u nocasematch

offenders=()
fixtures=()
for hit in ${hits[@]+"${hits[@]}"}; do
  if [[ $hit =~ $FIXTURE_RE ]]; then
    fixtures+=("$hit")
  else
    offenders+=("$hit")
  fi
done

# has_provenance <file name> -> 0 when $tmp (the staged PROVENANCE_FILE) has its line.
has_provenance() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line == "- \`$1\`: authored with "[![:space:]]*" from "[![:space:]]* ]]; then
      return 0
    fi
  done <"$tmp"
  return 1
}

# The redirect empties $tmp even when the file is untracked or unreadable, and every
# fixture then fails, which is the verdict.
git -C "$TOP" cat-file blob ":$PROVENANCE_FILE" >"$tmp" 2>/dev/null
unprovenanced=()
for fixture in ${fixtures[@]+"${fixtures[@]}"}; do
  has_provenance "${fixture##*/}" || unprovenanced+=("$fixture")
done

failed=$((${#offenders[@]} + ${#unprovenanced[@]}))
if [ "$failed" -ne 0 ]; then
  printf '\ncheck-no-course-content: %d tracked path(s) that may hold course material\n' \
    "$failed" >&2
  for offender in ${offenders[@]+"${offenders[@]}"}; do
    printf '  ERROR %s\n' "$offender" >&2
  done
  for fixture in ${unprovenanced[@]+"${unprovenanced[@]}"}; do
    printf '  ERROR %s (no provenance line in %s)\n' "$fixture" "$PROVENANCE_FILE" >&2
  done
  printf '\nThe repo never contains real course material (CLAUDE.md § Hard constraints).\n' >&2
  printf 'Untrack it (git rm --cached <path>). The one exemption is a synthetic fixture at\n' >&2
  printf '%s/<stem>.{%s} with a provenance line in %s;\n' \
    "$FIXTURE_DIR" "${FIXTURE_EXTENSIONS// /,}" "$PROVENANCE_FILE" >&2
  printf 'the header of .claude/scripts/check-no-course-content.sh declares both.\n' >&2
  exit 1
fi

printf 'check-no-course-content: OK — no %s/ path or .{%s} file among %d tracked paths' \
  "$BANNED_DIR" "${BANNED_EXTENSIONS// /,}" "$tracked"
printf ', apart from %d provenanced fixture(s) in %s/\n' "${#fixtures[@]}" "$FIXTURE_DIR"
