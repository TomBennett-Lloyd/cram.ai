#!/usr/bin/env bash
# Test harness for overlap-read.sh, run against throwaway repositories under its own `mktemp -d`
# tree. origin/main is a plain ref there, which is all the script reads of a remote.
#
# Usage: bash .claude/scripts/overlap-read.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
SUBJECT=${OVERLAP_READ_SCRIPT:-$SCRIPTS/overlap-read.sh}

harness_init_tmp

# fixture <name> -> REPO, a repository on `main` holding a.txt, b.txt, d.txt and the three logs,
# one commit, with origin/main at it.
fixture() {
  REPO="$TMP_ROOT/$1"
  must git init --quiet -b main "$REPO"
  must git -C "$REPO" config user.email t@example.invalid
  must git -C "$REPO" config user.name t
  must mkdir -p "$REPO/docs"
  for f in a.txt b.txt d.txt docs/tech-debt.md docs/friction-log.md docs/review-feedback.md; do
    printf 'base\n' >"$REPO/$f"
  done
  must git -C "$REPO" add -A
  must git -C "$REPO" commit --quiet -m base
  must git -C "$REPO" update-ref refs/remotes/origin/main main
}

# branch <name> <file>... — a branch off the fixture's first commit changing each file
branch() {
  local name=$1
  shift
  must git -C "$REPO" switch --quiet -c "$name" main
  for f in "$@"; do
    printf '%s\n' "$name" >"$REPO/$f"
  done
  must git -C "$REPO" commit --quiet -am "$name"
  must git -C "$REPO" update-ref "refs/remotes/origin/$name" "$name"
}

# advance_main <file> — main (and origin/main) moves on, changing <file>
advance_main() {
  must git -C "$REPO" switch --quiet main
  printf 'main moved\n' >"$REPO/$1"
  must git -C "$REPO" commit --quiet -am "main moves $1"
  must git -C "$REPO" update-ref refs/remotes/origin/main main
}

read_overlap() { capture -C "$REPO" bash "$SUBJECT" "$@"; }

# ==========================================================================================
begin "overlap-read.sh parses (bash -n)"
expect_parses "$SUBJECT"
end

# ==========================================================================================
begin "a path R and H both change is added to H's conflicts"
fixture both
branch r a.txt
branch h a.txt
read_overlap origin/r h
expect_rc 0
expect_stdout "read 1: rc=0 paths=0"
expect_stdout "adds a.txt"
end

# ==========================================================================================
begin "disjoint paths add nothing"
fixture disjoint
branch r b.txt
branch h a.txt
read_overlap origin/r h
expect_rc 0
expect_stdout "adds none"
end

# ==========================================================================================
begin "a conflict H already has, which R's landing leaves as it was, adds nothing"
fixture already2
branch r b.txt
branch h d.txt
advance_main d.txt
read_overlap origin/r h
expect_rc 0
expect_stdout "adds none"
expect_stdout "read 3: rc=1 paths=1"
end

# ==========================================================================================
begin "R that conflicts with main outside the logs is not ready"
fixture notready
branch r a.txt
branch h b.txt
advance_main a.txt
read_overlap origin/r h
expect_rc 1
expect_stdout "not-ready a.txt"
expect_not_stdout "read 2"
end

# ==========================================================================================
begin "R conflicting with main on a log alone is still ready"
fixture logr
branch r docs/tech-debt.md a.txt
branch h a.txt
advance_main docs/tech-debt.md
read_overlap origin/r h
expect_rc 0
expect_stdout "read 1: rc=1 paths=1"
expect_stdout "adds a.txt"
end

# ==========================================================================================
begin "an append-only log both R and H change is not added"
fixture logboth
branch r docs/friction-log.md
branch h docs/friction-log.md
read_overlap origin/r h
expect_rc 0
expect_stdout "adds none"
end

# ==========================================================================================
begin "an unresolvable ref and a wrong argument count are no verdict"
fixture refs
branch h a.txt
read_overlap origin/nope h
expect_rc 2
expect_stderr "origin/nope does not resolve"
read_overlap origin/h
expect_rc 2
expect_stderr "usage:"
end

finish
