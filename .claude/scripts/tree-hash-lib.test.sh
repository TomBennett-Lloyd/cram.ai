#!/usr/bin/env bash
# Test harness for tree-hash-lib.sh, its neighbour in this directory.
#
# A driver under TMP_ROOT sources the lib and prints worktree_tree's answer for a fixture
# repository, so a case compares trees rather than reading output for a substring. The
# last section reads verify-guard.sh and verify-tier.sh as text: neither may build the
# tree itself, because a second copy is the drift the lib exists to prevent (#715).
#
# Usage: bash .claude/scripts/tree-hash-lib.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
LIB="$SCRIPTS/tree-hash-lib.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

BG_PIDS=""
harness_extra_cleanup() {
  local p
  for p in $BG_PIDS; do
    kill "$p" 2>/dev/null
  done
}

REPO="$TMP_ROOT/repo"
must git init -q -b main "$REPO"
must git -C "$REPO" config user.email "harness@example.invalid"
must git -C "$REPO" config user.name "Harness"
must git -C "$REPO" config commit.gpgsign false
printf 'ignored/\n' >"$REPO/.gitignore" || exit 2
printf 'one\n' >"$REPO/tracked.txt" || exit 2
must mkdir -p "$REPO/ignored"
printf 'cache\n' >"$REPO/ignored/cache.txt" || exit 2
must git -C "$REPO" add -A
must git -C "$REPO" commit -q -m seed
must git -C "$REPO" tag seed_ref

DRIVER="$TMP_ROOT/driver.sh"
cat >"$DRIVER" <<DRIVER_END || exit 2
set -u
. "$LIB"
worktree_tree "\$1"
DRIVER_END

reset_repo() {
  rm -f "$REPO/.git/index.lock" "$REPO/.git/index"
  must git -C "$REPO" reset -q --hard seed_ref
  must git -C "$REPO" clean -fdq
  printf 'cache\n' >"$REPO/ignored/cache.txt" || exit 2
}

tree_of() { # tree_of [env words...] -> $rc and $out from the lib on $REPO
  capture env "$@" bash "$DRIVER" "$REPO"
}

head_tree() { git -C "$REPO" rev-parse 'HEAD^{tree}'; }

begin "a clean tree hashes to HEAD's own tree"
reset_repo
tree_of
expect_rc 0
[ "$out" = "$(head_tree)" ] || bad "got '$out', HEAD's tree is $(head_tree)"
end

begin "an untracked file is in the tree, and the tree is the one git add -A would stage"
reset_repo
printf 'draft\n' >"$REPO/untracked.txt" || exit 2
tree_of
expect_rc 0
got="$out"
must git -C "$REPO" add -A
[ "$got" = "$(git -C "$REPO" write-tree)" ] || bad "lib says $got, git add -A then write-tree says $(git -C "$REPO" write-tree)"
[ "$got" != "$(head_tree)" ] || bad "an untracked file left the tree equal to HEAD's"
end

begin "an edit changes the tree and putting it back restores it"
reset_repo
tree_of
before="$out"
printf 'two\n' >>"$REPO/tracked.txt" || exit 2
tree_of
[ "$out" != "$before" ] || bad "an edit to a tracked file did not move the tree"
printf 'one\n' >"$REPO/tracked.txt" || exit 2
tree_of
[ "$out" = "$before" ] || bad "the restored file did not restore the tree"
end

begin "a same-size edit whose mtime is untouched still moves the tree"
reset_repo
tree_of
before="$out"
touch -r "$REPO/tracked.txt" "$TMP_ROOT/stamp-ref"
printf 'ONE\n' >"$REPO/tracked.txt" || exit 2
touch -r "$TMP_ROOT/stamp-ref" "$REPO/tracked.txt"
tree_of
[ "$out" != "$before" ] || bad "content was not read: a same-size, same-mtime edit left the tree unchanged"
end

begin "an ignored file's edit is outside the tree"
reset_repo
tree_of
before="$out"
printf 'more\n' >>"$REPO/ignored/cache.txt" || exit 2
printf 'new\n' >"$REPO/ignored/other.txt" || exit 2
tree_of
[ "$out" = "$before" ] || bad "an ignored path moved the tree"
end

begin "an ignored file staged with add -f is in the tree"
reset_repo
tree_of
before="$out"
printf 'secret\n' >"$REPO/ignored/forced.txt" || exit 2
must git -C "$REPO" add -f ignored/forced.txt
tree_of
[ "$out" != "$before" ] || bad "a force-added ignored path left the tree unchanged"
git -C "$REPO" ls-tree -r --name-only "$out" | grep -qx 'ignored/forced.txt' || bad "ignored/forced.txt is not in tree $out"
end

begin "the real index is left as it was found"
reset_repo
printf 'draft\n' >"$REPO/untracked.txt" || exit 2
index_before=$(git -C "$REPO" ls-files --stage | git hash-object --stdin)
tree_of
[ "$(git -C "$REPO" ls-files --stage | git hash-object --stdin)" = "$index_before" ] || bad "hashing the tree staged something in the real index"
end

begin "a lock held briefly is retried and the tree is taken"
reset_repo
touch "$REPO/.git/index.lock"
(sleep 0.3 && rm -f "$REPO/.git/index.lock") &
BG_PIDS="$BG_PIDS $!"
tree_of
expect_rc 0
[ "$out" = "$(head_tree)" ] || bad "got '$out' after the lock cleared"
wait
end

begin "the same lock with one attempt is a failure, so the retry is what answered it"
reset_repo
touch "$REPO/.git/index.lock"
(sleep 0.3 && rm -f "$REPO/.git/index.lock") &
BG_PIDS="$BG_PIDS $!"
tree_of TREE_HASH_TRIES=1
expect_rc 1
[ -z "$out" ] || bad "printed '$out' on a failed attempt"
wait
end

begin "a lock that never clears fails after the attempts, and prints nothing"
reset_repo
touch "$REPO/.git/index.lock"
tree_of TREE_HASH_PAUSE=0.01
expect_rc 1
[ -z "$out" ] || bad "printed '$out' on a failed build"
rm -f "$REPO/.git/index.lock"
end

begin "a directory that is not a repository fails"
capture env GIT_CEILING_DIRECTORIES="$TMP_ROOT" TREE_HASH_PAUSE=0.01 bash "$DRIVER" "$TMP_ROOT"
expect_rc 1
end

begin "no attempt, failed or taken, leaves a temporary index behind"
reset_repo
leftovers="$TMP_ROOT/tmpdir"
must mkdir -p "$leftovers"
touch "$REPO/.git/index.lock"
tree_of TMPDIR="$leftovers" TREE_HASH_PAUSE=0.01
rm -f "$REPO/.git/index.lock"
tree_of TMPDIR="$leftovers"
[ -z "$(ls -A "$leftovers")" ] || bad "left behind: $(ls -A "$leftovers")"
end

# --- one implementation --------------------------------------------------------------------

begin "neither verify script builds the tree itself"
for f in verify-guard.sh verify-tier.sh; do
  hits=$(grep -n -E 'add -A|GIT_INDEX_FILE=' "$SCRIPTS/$f" | grep -v -E '^[0-9]+:[[:space:]]*#' || true)
  [ -z "$hits" ] || bad "$f builds a tree of its own: $hits"
  grep -q 'tree-hash-lib.sh' "$SCRIPTS/$f" || bad "$f does not name tree-hash-lib.sh"
done
end

finish
