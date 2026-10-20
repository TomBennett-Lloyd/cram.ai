#!/usr/bin/env bash
# Test harness for check-web-bundle.sh, its neighbour in this directory, ported from cumulo's.
# Every case runs the gate against a throwaway repo-shaped tree whose "entry chunk" is a file
# of exactly the size the case needs, sized from the gate's own --print-budget so no second
# copy of the budget exists. One case runs the gate with no argument against the real repo,
# so the shipped default root is exercised too (testing.md rule 7).
#
# Usage: bash .claude/scripts/check-web-bundle.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-web-bundle.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

budget=0

sized_file() { # sized_file <path> <bytes>
  mkdir -p "$(dirname "$1")" && head -c "$2" /dev/zero >"$1"
}

# fixture <name> [entry_bytes] -> sets DIR to a repo-shaped tree with one entry chunk,
# one byte under the budget unless told otherwise.
fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/apps/web/dist/assets"
  must sized_file "$DIR/apps/web/dist/assets/index-abc123.js" "${2:-$((budget - 1))}"
  must sized_file "$DIR/apps/web/dist/assets/index-abc123.css" 10
}

run_check_with() { # run_check_with <bash> <args...>
  local interpreter="$1"
  shift
  capture "$interpreter" "$CHECK" "$@"
}

run_check() { # run_check <args...>
  run_check_with bash "$@"
}

begin "check-web-bundle.sh parses (bash -n)"
expect_parses "$CHECK"
end

begin "--print-budget prints a positive integer and exits 0"
run_check --print-budget
expect_rc 0 "$rc"
budget="$out"
case "$budget" in
  '' | *[!0-9]*) bad "expected a bare integer, got: $budget" ;;
  *) [ "$budget" -gt 0 ] || bad "expected a positive budget, got: $budget" ;;
esac
end

case "$budget" in
  '' | *[!0-9]*)
    printf 'FATAL harness cannot size fixtures: --print-budget gave "%s"\n' "$budget" >&2
    exit 2
    ;;
esac

begin "a build under budget passes and lists the assets by size"
fixture clean
run_check "$DIR"
expect_rc 0 "$rc"
expect_out "check-web-bundle: OK"
expect_out "$((budget - 1))"
expect_out "apps/web/dist/assets/index-abc123.css"
end

begin "exactly the budget passes, one byte over fails"
case_ctx="entry == budget"
fixture at_budget "$budget"
run_check "$DIR"
expect_rc 0 "$rc"
expect_out "check-web-bundle: OK"

case_ctx="entry == budget + 1"
fixture over_budget "$((budget + 1))"
run_check "$DIR"
expect_rc 1 "$rc"
expect_out "over budget"
expect_out "over by 1 bytes"
expect_out "ENTRY_BUDGET_BYTES"
expect_not_out "check-web-bundle: OK"
case_ctx=""
end

begin "a missing build exits 2 and names the build command"
case_ctx="no dist/ at all"
fixture no_dist
must rm -rf "$DIR/apps/web/dist"
run_check "$DIR"
expect_rc 2 "$rc"
expect_out "no build to check"
expect_out "pnpm --filter @cram/web build"

case_ctx="dist/assets with no index-*.js"
fixture no_entry
must rm "$DIR/apps/web/dist/assets/index-abc123.js"
run_check "$DIR"
expect_rc 2 "$rc"
expect_out "no build to check"
case_ctx=""
end

begin "two index-*.js files exit 2 as stale artefacts, naming both"
fixture stale
must sized_file "$DIR/apps/web/dist/assets/index-def456.js" 1
run_check "$DIR"
expect_rc 2 "$rc"
expect_out "stale artefacts"
expect_out "index-abc123.js"
expect_out "index-def456.js"
expect_not_out "check-web-bundle: OK"
end

begin "a nonexistent root exits 2"
run_check "$TMP_ROOT/does-not-exist"
expect_rc 2 "$rc"
expect_out "not a directory"
end

begin "an unknown option exits 2"
run_check --nope
expect_rc 2 "$rc"
expect_out "unknown option"
end

begin "a second REPO_ROOT argument exits 2"
fixture two_roots
run_check "$DIR" "$DIR"
expect_rc 2 "$rc"
expect_out "expected at most one REPO_ROOT"
expect_not_out "check-web-bundle: OK"
end

# 0 or 2: dist/ is gitignored and absent whenever this runs before a build, as in CI's
# `checks` job; 1 would be a real assertion failure.
begin "the repo's own tree passes or reports no build, with no argument"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter"
  case "$rc" in
    0 | 2) ;;
    *) bad "expected 0 or 2, got $rc" ;;
  esac
  expect_out "apps/web/dist"
  expect_not_out "unbound variable"
done
case_ctx=""
end

finish
