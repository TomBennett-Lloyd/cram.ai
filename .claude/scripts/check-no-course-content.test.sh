#!/usr/bin/env bash
# Test harness for check-no-course-content.sh, its neighbour in this directory.
#
# Every fixture is a throwaway `git init` under the temp tree `harness_init_tmp` makes, and
# every banned path is staged with `git add -f`. The offending cases are the gate's
# negative controls, committed rather than run once by hand (docs/standards/testing.md rule 4).
#
# One case runs the gate with NO argument, against the real repo (testing.md rule 7), and two
# read the real .gitignore's course-content block: every ban in it must be flagged by the
# gate and every `!` re-include exempted, and the floor must ignore what the gate refuses
# and admit what it exempts.
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

FIXTURE_DIR=packages/ingest/fixtures
EXEMPT_SAMPLES="$FIXTURE_DIR/x.pdf $FIXTURE_DIR/x.pptx"

# provenance <line> -> appends a line to $DIR's provenance file, unstaged.
provenance() {
  must mkdir -p "$DIR/$FIXTURE_DIR"
  printf '%s\n' "$1" >>"$DIR/$FIXTURE_DIR/README.md"
}

# provenanced <repo-relative path> -> stages the fixture and a well-formed line naming it.
provenanced() {
  stage "$1"
  provenance "- \`${1##*/}\`: authored with harness from inline text"
}

stage_provenance() {
  must git -C "$DIR" add -- "$FIXTURE_DIR/README.md"
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
# 6. every banned extension
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

# -z is what makes this pass: without it git octal-escapes and quotes the name, and the
# closing quote defeats the extension's end anchor.
begin "a non-ASCII file name fails"
fixture non_ascii
stage "lectures/Week 3 – Entropy.pdf"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR lectures/Week 3 – Entropy.pdf"
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
# 7. data/ at any depth, any case
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
# gets a file under it). A ban the gate does not flag is a rule nobody enforces; a `!`
# re-include the gate does not exempt is a fixture nobody can commit.
begin "every ban in .gitignore's course-content block is flagged, every re-include exempted"
fixture parity
patterns=$(awk '/^# Course content/ { inblock = 1; next }
  inblock && /^$/ { exit }
  inblock && !/^#/ { print }' "$GITIGNORE")
if [ -z "$patterns" ]; then
  bad "no patterns read from the course-content block of $GITIGNORE — the census is broken"
fi
count=0
samples=()
reincluded=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] || continue
  sample=${pattern#!}
  sample=${sample#/}
  sample=${sample//\*/x}
  case "$sample" in
    */) sample="${sample}x" ;;
  esac
  case "$pattern" in
    !*)
      provenanced "$sample"
      reincluded+=("$sample")
      ;;
    *)
      stage "$sample"
      samples+=("$sample")
      count=$((count + 1))
      ;;
  esac
done <<EOF
$patterns
EOF
if [ ${#reincluded[@]} -ne 0 ]; then
  stage_provenance
fi
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "$count tracked path(s)"
for sample in ${samples[@]+"${samples[@]}"}; do
  expect_stderr "ERROR $sample"
done
for sample in ${reincluded[@]+"${reincluded[@]}"}; do
  expect_not_stderr "ERROR $sample"
done
end

begin "the .gitignore floor admits the exempt shape and ignores every widening of it"
DIR="$TMP_ROOT/floor"
must mkdir -p "$DIR"
must git -C "$DIR" init -q
must cp "$GITIGNORE" "$DIR/.gitignore"
floor_ignores() { # floor_ignores <path> -> check-ignore's rc: 0 ignored, 1 admitted
  git -C "$DIR" -c core.excludesFile=/dev/null check-ignore -q --no-index -- "$1"
}
for sample in $EXEMPT_SAMPLES; do
  case_ctx="$sample"
  floor_ignores "$sample"
  expect_rc 1 "$?"
done
for sample in "$FIXTURE_DIR/sub/x.pdf" "$FIXTURE_DIR/data/x.pdf" "$FIXTURE_DIR-extra/x.pdf" \
  "vendor/$FIXTURE_DIR/x.pdf" "$FIXTURE_DIR/x.ppt" "$FIXTURE_DIR/x.key" \
  "$FIXTURE_DIR/x.sqlite" "$FIXTURE_DIR/x.sqlite-wal"; do
  case_ctx="$sample"
  floor_ignores "$sample"
  expect_rc 0 "$?"
done
case_ctx=""
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

# ==========================================================================================
# 11. the one exemption: synthetic ingest fixtures with provenance (#31)
# ==========================================================================================
begin "a provenanced fixture of the exempt shape passes"
fixture exempt
provenanced "$FIXTURE_DIR/minimal.pdf"
provenanced "$FIXTURE_DIR/Deck_2-b.pptx"
# The last line has no newline: a final line is still read.
stage "$FIXTURE_DIR/last.pdf"
printf '%s' "- \`last.pdf\`: authored with harness from inline text" >>"$DIR/$FIXTURE_DIR/README.md"
stage_provenance
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter" "$DIR"
  expect_rc 0 "$rc"
  expect_stdout "among 6 tracked paths, apart from 3 provenanced fixture(s) in $FIXTURE_DIR/"
  expect_not_out "ERROR"
done
case_ctx=""
end

# Each sample has its own well-formed provenance line, so only its shape can fail it.
begin "every widening of the exempt shape fails, provenance or not"
fixture widened
widened="$FIXTURE_DIR/sub/w1.pdf $FIXTURE_DIR/data/w2.pdf $FIXTURE_DIR-extra/w3.pdf
  vendor/$FIXTURE_DIR/w4.pdf $FIXTURE_DIR/w5.ppt $FIXTURE_DIR/w6.key $FIXTURE_DIR/w7.sqlite
  $FIXTURE_DIR/w8.sqlite-wal $FIXTURE_DIR/w9.PDF $FIXTURE_DIR/w10.key.pdf
  $FIXTURE_DIR/w11.pdf/w11b.txt"
for sample in $widened; do
  provenanced "$sample"
done
stage_provenance
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter" "$DIR"
  expect_rc 1 "$rc"
  expect_stderr "11 tracked path(s)"
  for sample in $widened; do
    expect_stderr "ERROR $sample"
  done
  expect_not_stderr "no provenance line"
done
case_ctx=""
end

begin "a fixture without a well-formed, staged provenance line fails"
fixture unprovenanced
provenanced "$FIXTURE_DIR/ok.pdf"
stage "$FIXTURE_DIR/no-tool.pdf"
provenance "- \`no-tool.pdf\`: authored with  from notes.md"
stage "$FIXTURE_DIR/no-inputs.pdf"
provenance "- \`no-inputs.pdf\`: authored with pandoc from "
stage "$FIXTURE_DIR/no-from.pdf"
provenance "- \`no-from.pdf\`: authored with pandoc"
stage "$FIXTURE_DIR/indented.pdf"
provenance "  - \`indented.pdf\`: authored with pandoc from indented.md"
stage "$FIXTURE_DIR/bare.pdf"
provenance "- bare.pdf: authored with pandoc from bare.md"
stage "$FIXTURE_DIR/unstaged.pdf"
stage_provenance
provenance "- \`unstaged.pdf\`: authored with pandoc from unstaged.md"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_check_with "$interpreter" "$DIR"
  expect_rc 1 "$rc"
  expect_stderr "6 tracked path(s)"
  for name in no-tool no-inputs no-from indented bare unstaged; do
    expect_stderr "ERROR $FIXTURE_DIR/$name.pdf (no provenance line in $FIXTURE_DIR/README.md)"
  done
  expect_not_stderr "ERROR $FIXTURE_DIR/ok.pdf"
done
case_ctx=""
end

begin "a fixture fails when the provenance file is on disk but not tracked"
fixture untracked_provenance
provenanced "$FIXTURE_DIR/minimal.pdf"
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "ERROR $FIXTURE_DIR/minimal.pdf (no provenance line in $FIXTURE_DIR/README.md)"
end

finish
