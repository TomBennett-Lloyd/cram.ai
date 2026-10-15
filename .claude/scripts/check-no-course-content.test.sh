#!/usr/bin/env bash
# Test harness for check-no-course-content.sh, its neighbour in this directory.
#
# Every fixture is a throwaway `git init` under the temp tree `harness_init_tmp` makes, and
# every banned path is staged with `git add -f` — the one way past the .gitignore floor, and
# so the one way this gate's failure path can be reached. The offending cases are the gate's
# negative controls, committed rather than run once by hand (docs/standards/testing.md rule 4).
#
# One case runs the gate with NO argument, against the real repo (testing.md rule 7), and one
# reads the real .gitignore's course-content block: every pattern in it must be flagged by
# the gate, so the floor and the rule cannot drift apart.
#
# Usage: bash .claude/scripts/check-no-course-content.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-no-course-content.sh"
GITIGNORE="$SCRIPTS/../../.gitignore"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

# --- fixtures ----------------------------------------------------------------------------

# fixture <name> -> sets DIR to a fresh repo whose index holds two innocent files.
fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/src"
  must git -C "$DIR" init -q
  must touch "$DIR/README.md" "$DIR/src/index.ts"
  must git -C "$DIR" add README.md src/index.ts
}

# stage <repo-relative path> -> creates the file in $DIR and forces it into the index.
stage() {
  must mkdir -p "$(dirname "$DIR/$1")"
  must touch "$DIR/$1"
  must git -C "$DIR" add -f -- "$1"
}

run_check_with() { # run_check_with <bash> <args...>
  local interpreter="$1"
  shift
  capture "$interpreter" "$CHECK" "$@"
}

run_check() { # run_check <args...>
  run_check_with bash "$@"
}

# ==========================================================================================
# 1. the gate parses
# ==========================================================================================
begin "check-no-course-content.sh parses (bash -n)"
expect_parses "$CHECK"
end

# ==========================================================================================
# 2. the real repo, via the shipped default path (no argument)
# ==========================================================================================
begin "the repo's own index passes with no argument"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter"
  expect_rc 0 "$rc"
  expect_stdout "check-no-course-content: OK"
  expect_not_out "unbound variable"
done
case_ctx=""
end

# ==========================================================================================
# 3. bootstrap: an empty index passes
# ==========================================================================================
begin "a repo with nothing tracked passes"
DIR="$TMP_ROOT/empty"
must mkdir -p "$DIR"
must git -C "$DIR" init -q
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter" "$DIR"
  expect_rc 0 "$rc"
  expect_stdout "among 0 tracked paths"
done
case_ctx=""
end

# ==========================================================================================
# 4. near misses pass — the ban is on components, not substrings
# ==========================================================================================
begin "names that merely contain a banned word pass"
fixture near_miss
for path in metadata/course.json src/data.ts src/database/schema.ts docs/pdf-export.md \
  eval/slides.pdf.md decks/week1.keynote/notes.md src/data; do
  stage "$path"
done
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "check-no-course-content: OK"
expect_stdout "among 9 tracked paths"
expect_not_out "ERROR"
end

# ==========================================================================================
# 5. the census is the index: an unstaged file on disk is not the gate's business
# ==========================================================================================
begin "a banned file on disk but not in the index passes"
fixture untracked
must touch "$DIR/lecture.pdf"
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "check-no-course-content: OK"
end

# ==========================================================================================
# 6. POSITIVE CONTROLS: every banned extension
# ==========================================================================================
begin "every banned extension fails the gate"
for ext in pdf pptx ppt key sqlite; do
  case_ctx=".$ext"
  fixture "ext_$ext"
  stage "slides/lecture.$ext"
  run_check "$DIR"
  expect_rc 1 "$rc"
  expect_stderr "ERROR slides/lecture.$ext"
  expect_stderr "1 tracked path(s)"
  expect_not_stdout "check-no-course-content: OK"
done
case_ctx=""
end

begin "an upper-case extension fails — the floor is case-sensitive on Linux, the gate is not"
fixture upper
stage "LECTURE.PDF"
stage "Week2.PpTx"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR LECTURE.PDF"
expect_stderr "ERROR Week2.PpTx"
expect_stderr "2 tracked path(s)"
end

begin "sqlite sidecar files fail"
fixture sqlite_sidecars
stage "index.sqlite-wal"
stage "index.sqlite-shm"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR index.sqlite-wal"
expect_stderr "ERROR index.sqlite-shm"
end

begin "a file inside a Keynote bundle fails"
fixture key_bundle
stage "decks/week1.key/Index.zip"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR decks/week1.key/Index.zip"
end

# ==========================================================================================
# 7. POSITIVE CONTROLS: data/ at any depth, any case
# ==========================================================================================
begin "anything under a data/ directory fails, at any depth"
fixture data_dirs
stage "data/course-1/index.json"
stage "packages/ingest/data/notes.md"
stage "apps/web/Data/readme.txt"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR data/course-1/index.json"
expect_stderr "ERROR packages/ingest/data/notes.md"
expect_stderr "ERROR apps/web/Data/readme.txt"
expect_stderr "3 tracked path(s)"
end

# ==========================================================================================
# 8. committed, and checked from a subdirectory
# ==========================================================================================
# CI sees HEAD, not a staged add; and a REPO_ROOT inside the tree still checks the whole index.
begin "a committed banned file fails, even when the gate is pointed at a subdirectory"
fixture committed
stage "data/deck.pdf"
must git -C "$DIR" -c user.name=harness -c user.email=harness@example.invalid \
  -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q -m fixture
run_check "$DIR/src"
expect_rc 1 "$rc"
expect_stderr "ERROR data/deck.pdf"
end

# ==========================================================================================
# 9. parity with the .gitignore floor
# ==========================================================================================
# Each pattern in the course-content block becomes a sample path (`*` -> `x`, a trailing `/`
# gets a file under it). A floor pattern the gate does not flag is a rule nobody enforces.
begin "every pattern in .gitignore's course-content block is flagged by the gate"
fixture parity
patterns=$(awk '/^# Course content/ { inblock = 1; next }
  inblock && /^$/ { exit }
  inblock && !/^#/ { print }' "$GITIGNORE")
if [ -z "$patterns" ]; then
  bad "no patterns read from the course-content block of $GITIGNORE — the census is broken"
fi
count=0
samples=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] || continue
  sample=${pattern//\*/x}
  case "$sample" in
    */) sample="${sample}x" ;;
  esac
  stage "$sample"
  samples+=("$sample")
  count=$((count + 1))
done <<EOF
$patterns
EOF
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "$count tracked path(s)"
for sample in ${samples[@]+"${samples[@]}"}; do
  expect_stderr "ERROR $sample"
done
end

# ==========================================================================================
# 10. a wrong invocation is exit 2, not a verdict
# ==========================================================================================
begin "a non-directory and a non-repository are invocation errors"
run_check "$TMP_ROOT/does-not-exist"
expect_rc 2 "$rc"
expect_stderr "not a directory"
must mkdir -p "$TMP_ROOT/plain"
run_check "$TMP_ROOT/plain"
expect_rc 2 "$rc"
expect_stderr "not a git work tree"
end

finish
