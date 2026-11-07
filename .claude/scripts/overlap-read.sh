#!/usr/bin/env bash
#
# The overlap read the merge owner takes before ordering ready PRs: what landing PR R adds to
# the conflicts of another in-flight branch H. The procedure it serves is stated in
# .claude/skills/run-issue/merge-order.md; this script is the one place the reads are spelled (#668).
#
# Usage (from the repository, after `git fetch origin`):
#   bash .claude/scripts/overlap-read.sh <R> <H>
#
#     R   the ready PR's ref, as `origin/<branch>`
#     H   the other in-flight branch, as the LOCAL ref `<branch>`: worktrees share refs/heads
#         and a lane pushes nothing before its PR
#
# The three reads, each a `git merge-tree --write-tree --name-only --no-messages`:
#   1. origin/main + R  -> tree T (a probe commit C is made on it: a dangling throwaway, left to gc)
#   2. C + H            -> the conflicts H has once R has landed
#   3. origin/main + H  -> the conflicts H has now
# What R's landing adds is read 2's paths less read 3's, less the append-only logs, which
# merge-pr.sh unions (its APPEND_ONLY_LOGS is the one list; this script reads it from there).
#
# Output (stdout): one `read <n>: rc=<rc> paths=<count>` line per read, then one `adds <path>` line
# per path, or `adds none`.
#
# Exit:  0 the reads completed (the output says what R adds); 1 R is not ready: read 1 conflicts
#        on a path outside the logs, each printed as `not-ready <path>`; 2 no verdict (bad
#        arguments, an unresolvable ref, a merge-tree error, or no log list to read).
#
set -uo pipefail
export PATH="$PATH:/opt/homebrew/bin"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2

if [ $# -ne 2 ]; then
  printf 'usage: overlap-read.sh <R> <H>\n' >&2
  exit 2
fi
R=$1
H=$2

logs=$(sed -n 's/^APPEND_ONLY_LOGS=(\(.*\))$/\1/p' "$SCRIPTS/merge-pr.sh" | grep -o "'[^']*'" | tr -d "'")
if [ -z "$logs" ]; then
  printf 'overlap-read: found no APPEND_ONLY_LOGS in %s\n' "$SCRIPTS/merge-pr.sh" >&2
  exit 2
fi

for ref in origin/main "$R" "$H"; do
  if ! git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    printf 'overlap-read: %s does not resolve to a commit\n' "$ref" >&2
    exit 2
  fi
done

# read_paths <n> <a> <b> -> READ_TREE (line 1) and READ_PATHS (line 2 on, sorted, one per line),
# having printed the read's own line. An rc other than 0 or 1 is no verdict.
read_paths() {
  local n=$1 a=$2 b=$3 out rc
  out=$(git merge-tree --write-tree --name-only --no-messages "$a" "$b")
  rc=$?
  if [ "$rc" -gt 1 ]; then
    printf 'overlap-read: read %s (merge-tree %s %s) exited %s\n' "$n" "$a" "$b" "$rc" >&2
    exit 2
  fi
  READ_TREE=${out%%$'\n'*}
  if [ "$out" = "$READ_TREE" ]; then
    READ_PATHS=""
  else
    READ_PATHS=$(printf '%s\n' "${out#*$'\n'}" | sort -u)
  fi
  printf 'read %s: rc=%s paths=%s\n' "$n" "$rc" "$(printf '%s' "$READ_PATHS" | grep -c .)"
}

# not_logs <paths> -> the paths that are not one of the append-only logs
not_logs() {
  printf '%s\n' "$1" | grep . | grep -vxF -f <(printf '%s\n' "$logs") || true
}

read_paths 1 origin/main "$R"
blocking=$(not_logs "$READ_PATHS")
if [ -n "$blocking" ]; then
  printf '%s\n' "$blocking" | sed 's/^/not-ready /'
  exit 1
fi

C=$(git commit-tree "$READ_TREE" -p origin/main -m probe) || exit 2

read_paths 2 "$C" "$H"
with_r=$READ_PATHS
read_paths 3 origin/main "$H"
now=$READ_PATHS

adds=$(comm -23 <(printf '%s\n' "$with_r" | grep . || true) <(printf '%s\n' "$now" | grep . || true))
adds=$(not_logs "$adds")
if [ -z "$adds" ]; then
  printf 'adds none\n'
else
  printf '%s\n' "$adds" | sed 's/^/adds /'
fi
