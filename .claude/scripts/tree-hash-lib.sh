#!/usr/bin/env bash
# The one definition of "the content of this working tree" that `pnpm verify` uses
# (#715). Sourced, never executed.
#
# verify-guard.sh stamps the tree to void a run whose tree moved; verify-tier.sh hashes
# it to bank a green run and to measure the delta since one. Two implementations of the
# same question can disagree about a file (one counts it, the other ignores it), and then
# the guard says "unchanged" while the bank says "changed", voiding or banking the wrong
# run. Both call this instead.
#
# Usage:
#
#   # shellcheck source=./tree-hash-lib.sh
#   . "$SCRIPT_DIR/tree-hash-lib.sh"
#   tree=$(worktree_tree "$ROOT") || …
#
# worktree_tree <root> prints the tree object of <root>'s working tree as `git add -A`
# would stage it, and returns 1 when git could not build it.
#
# The tree is built in a throwaway index seeded from the real index with `read-tree`, so
# it holds every staged path (`git add -f` of an ignored file included, which an empty
# index would drop and check:no-course-content exists for) and carries no stat data: every
# file is hashed from its content, where a copy of the real index would carry its stat
# cache under a newer mtime and defeat git's racy-entry check. Untracked files are in the
# tree; ignored ones are not, by design, since a build or cache write is not an edit to
# what is being verified.
#
# `git write-tree` against the real index takes its index.lock, which another git
# process in the same work tree (a status refresh, a commit) may hold for a moment, so a
# failed build is retried before it counts as failed. TREE_HASH_TRIES and TREE_HASH_PAUSE
# (seconds) set the attempts and the wait between them.
#
# Its harness is tree-hash-lib.test.sh next door.

TREE_HASH_TRIES=${TREE_HASH_TRIES:-5}
TREE_HASH_PAUSE=${TREE_HASH_PAUSE:-0.2}

# _worktree_tree_once <root> -> one attempt; the tree object on stdout.
_worktree_tree_once() {
  local root=$1 idx staged tree
  idx=$(mktemp "${TMPDIR:-/tmp}/tree-hash-index.XXXXXX") || return 1
  rm -f "$idx"
  if ! staged=$(git -C "$root" write-tree 2>/dev/null) ||
    ! GIT_INDEX_FILE="$idx" git -C "$root" read-tree "$staged" >/dev/null 2>&1 ||
    ! GIT_INDEX_FILE="$idx" git -C "$root" add -A >/dev/null 2>&1 ||
    ! tree=$(GIT_INDEX_FILE="$idx" git -C "$root" write-tree 2>/dev/null); then
    rm -f "$idx"
    return 1
  fi
  rm -f "$idx"
  printf '%s\n' "$tree"
}

# worktree_tree <root> -> the tree object of the working tree on stdout, or 1.
worktree_tree() {
  local tries=0 tree
  while [ "$tries" -lt "$TREE_HASH_TRIES" ]; do
    if tree=$(_worktree_tree_once "$1"); then
      printf '%s\n' "$tree"
      return 0
    fi
    tries=$((tries + 1))
    sleep "$TREE_HASH_PAUSE"
  done
  return 1
}
