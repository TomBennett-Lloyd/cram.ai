#!/usr/bin/env bash
# Test harness for check-commit-subjects.sh, its neighbour in this directory.
#
# Every fixture is a throwaway repo under the temp tree `harness_init_tmp` makes, with an
# `origin/main` ref made by update-ref so no remote or network is involved. The offending
# cases are the gate's negative controls, committed rather than run once by hand
# (docs/standards/testing.md rule 4).
#
# Usage: bash .claude/scripts/check-commit-subjects.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-commit-subjects.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

# fixture <name> <branch> -> sets DIR to a repo whose origin/main is one commit and whose
# checked-out branch is <branch>, with no commit of its own yet.
fixture() {
  DIR="$TMP_ROOT/$1"
  must git init -q -b main "$DIR"
  must git -C "$DIR" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "base commit with no prefix"
  must git -C "$DIR" update-ref refs/remotes/origin/main HEAD
  must git -C "$DIR" checkout -q -b "$2"
}

commit() { # commit <subject>
  must git -C "$DIR" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$1"
}

run_check() {
  capture env -u GITHUB_HEAD_REF bash "$CHECK" "$DIR"
}

begin "check-commit-subjects.sh parses (bash -n)"
expect_parses "$CHECK"
end

begin "the repo's own branch passes with no argument"
capture env -u GITHUB_HEAD_REF bash "$CHECK"
expect_rc 0 "$rc"
expect_out "check-commit-subjects: OK"
end

begin "a lane branch whose subjects all begin #<n>: passes"
fixture good 671-slug
commit "#671: first step"
commit "#671: second step"
run_check
expect_rc 0 "$rc"
expect_out "2 commit subject(s)"
end

begin "a subject without the prefix fails and is named"
fixture bare 671-slug
commit "#671: fine"
commit "tidy the thing"
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR"
expect_stderr "tidy the thing"
expect_stderr "1 of 2 commit subject(s)"
end

begin "a subject whose #<n> has no colon-space fails"
fixture nocolon 671-slug
commit "#671 no colon"
run_check
expect_rc 1 "$rc"
end

begin "a subject with a non-numeric tag fails"
fixture tag 671-slug
commit "#abc: not a number"
run_check
expect_rc 1 "$rc"
end

begin "a prefix that is not at the start fails"
fixture mid 671-slug
commit "fix #671: late"
run_check
expect_rc 1 "$rc"
end

begin "a merge commit with its own subject is exempt"
fixture merge 671-slug
commit "#671: on the branch"
must git -C "$DIR" checkout -q -b side origin/main
commit "#1: on main's side"
must git -C "$DIR" update-ref refs/remotes/origin/main HEAD
must git -C "$DIR" checkout -q 671-slug
must git -C "$DIR" -c user.name=t -c user.email=t@t merge -q --no-ff -m "Merge branch 'main' into 671-slug" side
run_check
expect_rc 0 "$rc"
expect_out "1 commit subject(s)"
end

begin "a branch not named <n>-<slug> is skipped even with bad subjects"
fixture retro retro-2026
commit "retro: a note"
run_check
expect_rc 0 "$rc"
expect_out "not a lane branch"
end

begin "a branch whose number is followed by letters before the dash is not a lane branch"
fixture alnum 6a-slug
commit "no prefix here"
run_check
expect_rc 0 "$rc"
expect_out "not a lane branch"
end

begin "a subject '#<n>:' with no space after the colon fails"
fixture nospace 671-slug
commit "#671:glued"
run_check
expect_rc 1 "$rc"
end

begin "a subject '#:' with no number fails"
fixture nonum 671-slug
commit "#: nothing"
run_check
expect_rc 1 "$rc"
end

begin "GITHUB_HEAD_REF names the lane branch on a detached checkout"
fixture detached 671-slug
commit "no prefix here"
must git -C "$DIR" checkout -q --detach
capture env GITHUB_HEAD_REF=671-slug bash "$CHECK" "$DIR"
expect_rc 1 "$rc"
expect_stderr "no prefix here"
end

begin "an unresolvable origin/main fails closed"
fixture nobase 671-slug
must git -C "$DIR" update-ref -d refs/remotes/origin/main
run_check
expect_rc 2 "$rc"
expect_stderr "origin/main does not resolve"
end

finish
