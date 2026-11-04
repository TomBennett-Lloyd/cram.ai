#!/usr/bin/env bash
# Test harness for adr-amendment-check.mjs, its neighbour in this directory.
#
# Every diff is real `git diff -M` output from a fixture repository, so the subject is tested on
# the grammar git writes rather than on diffs this file imagined (#560). merge-pr.test.sh covers
# the wiring into the feedback step; this file covers the verdicts.
#
# Usage: bash .claude/scripts/adr-amendment-check.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SUBJECT="$SCRIPTS/adr-amendment-check.mjs"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

export GIT_CONFIG_GLOBAL="$TMP_ROOT/gitconfig" GIT_CONFIG_NOSYSTEM=1
must git config --file "$GIT_CONFIG_GLOBAL" user.name test
must git config --file "$GIT_CONFIG_GLOBAL" user.email test@test
must git config --file "$GIT_CONFIG_GLOBAL" commit.gpgsign false
must git config --file "$GIT_CONFIG_GLOBAL" core.hooksPath "$TMP_ROOT/no-hooks"
must git config --file "$GIT_CONFIG_GLOBAL" init.defaultBranch main

ADR=docs/adr/0009-thing.md
OLD=packages/a/src/depth.ts
NEW=packages/b/src/depth.ts
REPO="" DIFF=""

# repo — a base commit holding an accepted ADR with one Decision point and one prior amendment,
# the file it names, and the template. Cases edit the work tree; diff() reads it.
repo() {
  REPO="$TMP_ROOT/repo-$1"
  DIFF="$TMP_ROOT/$1.diff"
  must mkdir -p "$REPO/docs/adr" "$REPO/packages/a/src"
  cat >"$REPO/$ADR" <<EOF
# 0009 — Thing

- **Status:** accepted

## Decision

- **(f) The depth is owned.**
  - The depth is owned by \`$OLD\`, and its ledger is declared with it.
  - Ask is light.
  - The guide is deep.
  - Nothing else changes.

## Amendments

- **2026-11-01 — (f): an earlier entry** (#1).
  - Was: x.
EOF
  printf 'export const DEPTH = 1;\n' >"$REPO/$OLD"
  printf '# template\n' >"$REPO/docs/adr/0000-template.md"
  must git -C "$REPO" init --quiet
  must git -C "$REPO" add -A
  must git -C "$REPO" commit --quiet -m base
}

move() { # the file move the (b) cases tie their path change to
  must mkdir -p "$REPO/packages/b/src"
  must git -C "$REPO" mv "$OLD" "$NEW"
}

entry() { # appends a dated amendment entry at the end of the ADR
  printf -- "- **2026-11-03 — (f): the owner moved** (#2).\n  - Was: \`%s\`.\n  - Now: \`%s\`.\n" "$OLD" "$NEW" >>"$REPO/$ADR"
}

# sub <old> <new> — replaces one whole line of the ADR, asserting it matched exactly once.
sub() {
  local n
  n=$(grep -cxF -- "$1" "$REPO/$ADR")
  [ "$n" = 1 ] || {
    printf 'FATAL fixture line matched %s times: %s\n' "$n" "$1" >&2
    exit 2
  }
  OLDL="$1" NEWL="$2" must node -e '
    const fs = require("fs"); const p = process.argv[1];
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").split("\n").map((l) => (l === process.env.OLDL ? process.env.NEWL : l)).join("\n"));
  ' "$REPO/$ADR"
}

diff_() { must git -C "$REPO" add -A && git -C "$REPO" diff --cached -M >"$DIFF"; }

LINE="  - The depth is owned by \`$OLD\`, and its ledger is declared with it."
MOVED="  - The depth is owned by \`$NEW\` (moved 2026-11-03; see § Amendments), and its ledger is declared with it."

# comment <file> <body-file> [issue] — the JSON `gh api …/issues/comments/<id>` answers.
comment() {
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({ issue_url: "https://api.github.com/repos/o/r/issues/" + process.argv[3], body: fs.readFileSync(process.argv[2], "utf8") }));
  ' "$1" "$2" "${3:-560}" || exit 2
}

# plan_with_diff — a plan comment pasting the ADR's diff, the form amendmentRule (a) names.
plan_with_diff() {
  { printf '## Plan (ticket-agent lane)\n\n```diff\n'; sed -n '/^@@/,$p' "$DIFF" | grep -v '^[\]'; printf '```\n'; } >"$TMP_ROOT/body"
  comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
}

run() { capture node "$SUBJECT" "$@"; }

# ==========================================================================================
# footprint
# ==========================================================================================
begin "footprint: an existing ADR modified in place is an amendment"
repo fp-ok
sub "  - Ask is light." "  - Ask is light, still."
diff_
run footprint "$DIFF" "$ADR"
expect_rc 0
end

begin "footprint: content lines that read as file headers inside a hunk stay content"
repo fp-headerish
sub "  - Ask is light." "-- a dash-led line"
must git -C "$REPO" commit --quiet -am 'dash-led line'
sub "-- a dash-led line" "++ a plus-led line"
diff_
grep -q '^--- a dash-led line$' "$DIFF" || bad "fixture: no header-shaped removed line"
grep -q '^+++ a plus-led line$' "$DIFF" || bad "fixture: no header-shaped added line"
run footprint "$DIFF" "$ADR"
expect_rc 0
printf '## Plan\n--- a dash-led line\n+++ a plus-led line\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 0
end

begin "footprint: each non-amendment shape refuses, naming it"
repo fp-bad
printf '# new\n' >"$REPO/docs/adr/0010-new.md"
printf '# t2\n' >>"$REPO/docs/adr/0000-template.md"
diff_
run footprint "$DIFF" docs/adr/0010-new.md
expect_rc 1
expect_stdout 'docs/adr/0010-new.md is a add'
run footprint "$DIFF" docs/adr/0000-template.md
expect_rc 1
expect_stdout 'is not an ADR file'
run footprint "$DIFF" CLAUDE.md
expect_rc 1
expect_stdout 'CLAUDE.md is not an ADR file'
run footprint "$DIFF" docs/adr/README.md
expect_rc 1
expect_stdout 'docs/adr/README.md is not an ADR file'
run footprint "$DIFF" docs/adr/sub/0009-x.md
expect_rc 1
expect_stdout 'is not an ADR file'
run footprint "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'is in the PR but not in its diff'
run footprint "$DIFF"
expect_rc 1
expect_stdout 'touches no humanAlways path'
end

begin "footprint: a deleted or renamed ADR is not an amendment"
repo fp-del
must git -C "$REPO" rm --quiet "$ADR"
diff_
run footprint "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'is a delete'
repo fp-ren
must git -C "$REPO" mv "$ADR" docs/adr/0009-renamed.md
diff_
run footprint "$DIFF" docs/adr/0009-renamed.md
expect_rc 1
expect_stdout 'is a rename'
end

# ==========================================================================================
# arm (b): path move
# ==========================================================================================
begin "path-move: a moved owner path, the dated pointer and the appended entry pass"
repo pm-ok
move
sub "$LINE" "$MOVED"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 0
expect_silent
end

begin "path-move: the pointer is optional, and 'amended' and a missing 'see' are its other arms"
for ptr in '' ' (amended 2026-11-03; § Amendments)' ' (moved 2026-11-03; § Amendments)'; do
  case_ctx="pointer '$ptr'"
  repo "pm-ptr-${#ptr}"
  move
  sub "$LINE" "  - The depth is owned by \`$NEW\`$ptr, and its ledger is declared with it."
  entry
  diff_
  run path-move "$DIFF" "$ADR"
  expect_rc 0
done
end

begin "path-move: a pointer at the line's start or end is stripped too"
repo pm-ptr-end
move
sub "$LINE" "  - The depth is owned by \`$NEW\`, and its ledger is declared with it. (moved 2026-11-03; see § Amendments)"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 0
end

begin "path-move: a near-miss pointer is words outside a path"
for ptr in ' (moved 2026-11-3; see § Amendments)' ' (moved 2026-11-03; see § Amendment)' ' (renamed 2026-11-03; see § Amendments)' ' (moved 2026-11-03, see § Amendments)' ' (MOVED 2026-11-03; see § Amendments)'; do
  case_ctx="pointer '$ptr'"
  repo "pm-near-$RANDOM"
  move
  sub "$LINE" "  - The depth is owned by \`$NEW\`$ptr, and its ledger is declared with it."
  entry
  diff_
  run path-move "$DIFF" "$ADR"
  expect_rc 1
  expect_stdout 'words outside a path change'
done
end

begin "path-move: two pointers on one line are one too many"
repo pm-two
move
sub "$LINE" "  - The depth is owned by \`$NEW\` (moved 2026-11-03; see § Amendments) (moved 2026-11-03; see § Amendments), and its ledger is declared with it."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'words outside a path change'
end

begin "path-move: an as-it-stood annotation is not a path move (the #439 shape)"
repo pm-annot
sub "  - Ask is light." "  - Ask is light. _(Quoted as it stood when this was written. Since 2026-11-03, Ask is deep; see § Amendments.)_"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'words outside a path change'
end

begin "path-move: a word changed beside the path refuses"
repo pm-word
move
sub "$LINE" "  - The depth is owned by \`$NEW\`, and its ledger is not declared with it."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'words outside a path change'
end

begin "path-move: a path span added or dropped refuses"
repo pm-span
move
sub "$LINE" "  - The depth is owned by \`$NEW\` and \`x/y.ts\`, and its ledger is declared with it."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'gains or loses a backticked span'
end

begin "path-move: a path the PR does not move refuses, whichever side is unmoved"
repo pm-nomove
sub "$LINE" "  - The depth is owned by \`$NEW\`, and its ledger is declared with it."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout "is not a file this PR moves"
repo pm-wrongnew
move
sub "$LINE" "  - The depth is owned by \`packages/c/src/depth.ts\`, and its ledger is declared with it."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout "is not a file this PR moves"
end

begin "path-move: a deleted old file and an added new one count as a move"
repo pm-deladd
must git -C "$REPO" rm --quiet "$OLD"
must mkdir -p "$REPO/packages/b/src"
printf 'something else entirely\nwith more lines\nso git sees no rename\n' >"$REPO/$NEW"
sub "$LINE" "$MOVED"
entry
diff_
grep -q '^rename from' "$DIFF" && bad "fixture: git detected a rename, so this case tests the rename arm twice"
run path-move "$DIFF" "$ADR"
expect_rc 0
end

begin "path-move: a span that swaps a moved path's sides refuses"
repo pm-swap
move
sub "$LINE" "  - The depth is owned by \`$OLD\`, and its ledger is declared with \`$NEW\`."
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
end

begin "path-move: lines replaced other than one for one refuse"
repo pm-arity
move
sub "  - Ask is light." "  - Ask is light."
must node -e '
  const fs = require("fs"); const p = process.argv[1];
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(process.argv[2] + "\n", process.argv[3] + "\n" + process.argv[3] + "\n"));
' "$REPO/$ADR" "$LINE" "$MOVED"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout '1 line(s) replaced by 2, not one for one'
end

begin "path-move: a line added mid-file refuses, even shaped like an entry"
for added in '  - Ask is deep too.' '- **2026-11-03 — (g): a new point** (#2).' ''; do
  case_ctx="added '$added'"
  repo "pm-mid-${#added}"
  move
  sub "$LINE" "$MOVED"
  must node -e '
    const fs = require("fs"); const p = process.argv[1];
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("  - Ask is light.\n", "  - Ask is light.\n" + process.argv[2] + "\n"));
  ' "$REPO/$ADR" "$added"
  entry
  diff_
  run path-move "$DIFF" "$ADR"
  expect_rc 1
  expect_stdout 'an added block that is not the dated entry appended at the end'
done
end

begin "path-move: a line removed mid-file refuses"
repo pm-del
move
sub "$LINE" "$MOVED"
must node -e '
  const fs = require("fs"); const p = process.argv[1];
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("  - The guide is deep.\n", ""));
' "$REPO/$ADR"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'replaced by 0, not one for one'
end

begin "path-move: the appended block must open with the heading or an entry, and hold an entry"
for tail in $'  - a stray bullet\n- **2026-11-03 — (f): x** (#2).' $'## Amendments\n\nno entry here' $'\n\n'; do
  case_ctx="tail '${tail:0:20}'"
  repo "pm-tail-$RANDOM"
  move
  sub "$LINE" "$MOVED"
  printf '%s\n' "$tail" >>"$REPO/$ADR"
  diff_
  run path-move "$DIFF" "$ADR"
  expect_rc 1
done
end

begin "path-move: a first amendment that adds the heading passes"
repo pm-first
must node -e '
  const fs = require("fs"); const p = process.argv[1];
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\n## Amendments[\s\S]*$/, "\n"));
' "$REPO/$ADR"
must git -C "$REPO" commit --quiet -am 'no amendments yet'
move
sub "$LINE" "$MOVED"
printf '\n## Amendments\n\n' >>"$REPO/$ADR"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 0
end

begin "path-move: no entry, or an entry with no inline path change, refuses"
repo pm-noentry
move
sub "$LINE" "$MOVED"
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'no dated amendment entry appended at the end'
repo pm-onlyentry
move
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout 'no inline path changes, so this is not a path move'
end

begin "path-move: a second ADR in the PR is held to the same test"
repo pm-two-adrs
cp "$REPO/$ADR" "$REPO/docs/adr/0003-other.md"
must git -C "$REPO" add -A
must git -C "$REPO" commit --quiet -m 'second adr'
move
sub "$LINE" "$MOVED"
entry
printf '  - an unrelated line\n' >>"$REPO/docs/adr/0003-other.md"
diff_
run path-move "$DIFF" "$ADR" docs/adr/0003-other.md
expect_rc 1
expect_stdout 'docs/adr/0003-other.md: an added block that is not the dated entry appended at the end'
end

# ==========================================================================================
# arm (a): plan-named
# ==========================================================================================
begin "plan-named: a plan comment that pastes the ADR diff passes"
repo pn-ok
sub "  - Ask is light." "  - Ask is light, and stays light."
entry
diff_
plan_with_diff
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 0
end

begin "plan-named: a pure addition named as plain text passes"
repo pn-plain
entry
diff_
{ printf 'Footprint change: +x\n\n## Plan (ticket-agent lane)\n\nThe entry, verbatim:\n\n'; sed -n '/^@@/,$p' "$DIFF" | sed -n 's/^+//p'; } >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 0
end

begin "plan-named: CRLF line ends and trailing spaces in the comment still match"
repo pn-crlf
entry
diff_
{ printf '## Plan\r\n'; sed -n '/^@@/,$p' "$DIFF" | sed -n 's/^\(+.*\)$/\1  \r/p'; } >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 0
end

begin "plan-named: a removed line named only as plain text refuses"
repo pn-removed
sub "  - Ask is light." "  - Ask is deep."
diff_
printf '## Plan\n\n  - Ask is light.\n+  - Ask is deep.\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 1
expect_stdout 'does not carry this removed line:   - Ask is light.'
printf '## Plan\n\n-  - Ask is light.\n+  - Ask is deep.\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 0
end

begin "plan-named: an added line that differs from the plan's refuses, wherever it sits"
for where in first last; do
  case_ctx="$where"
  repo "pn-differs-$where"
  sub "  - Ask is light." "  - Ask is light, and stays light."
  entry
  diff_
  plan_with_diff
  if [ "$where" = first ]; then
    sub "  - Ask is light, and stays light." "  - Ask is light, and stays deep."
  else
    sub "  - Now: \`$NEW\`." "  - Now: \`$NEW\`, and Ask is deep."
  fi
  diff_
  run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
  expect_rc 1
  expect_stdout 'does not carry this added line'
done
end

begin "plan-named: a substring of a plan line does not name the line"
repo pn-substring
sub "  - Ask is light." "  - Ask is light."
printf '  - Ask is' >>"$REPO/$ADR"
printf '\n' >>"$REPO/$ADR"
diff_
printf '## Plan\n\n+  - Ask is light, and much more.\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 1
end

begin "plan-named: the comment must be on the cited issue, and be a plan comment"
repo pn-where
entry
diff_
plan_with_diff
comment "$TMP_ROOT/other.json" "$TMP_ROOT/body" 5600
run plan-named "$DIFF" "$TMP_ROOT/other.json" 560 "$ADR"
expect_rc 1
expect_stdout 'the cited comment is not on #560'
printf 'Progress: done.\n### Plan\n' >"$TMP_ROOT/body2"
sed -n '/^@@/,$p' "$DIFF" >>"$TMP_ROOT/body2"
comment "$TMP_ROOT/report.json" "$TMP_ROOT/body2"
run plan-named "$DIFF" "$TMP_ROOT/report.json" 560 "$ADR"
expect_rc 1
expect_stdout 'is not a plan comment'
printf 'x ## Plan\n' >"$TMP_ROOT/body3"
comment "$TMP_ROOT/inline.json" "$TMP_ROOT/body3"
run plan-named "$DIFF" "$TMP_ROOT/inline.json" 560 "$ADR"
expect_rc 1
expect_stdout 'is not a plan comment'
end

begin "plan-named: a non-amendment footprint refuses before the comment is read"
repo pn-fp
printf '# new\n' >"$REPO/docs/adr/0010-new.md"
diff_
printf '## Plan\n+# new\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 docs/adr/0010-new.md
expect_rc 1
expect_stdout 'is a add'
end

begin "plan-named and path-move: an unreadable input exits 2"
repo unreadable
entry
diff_
printf 'not json' >"$TMP_ROOT/bad.json"
run plan-named "$DIFF" "$TMP_ROOT/bad.json" 560 "$ADR"
expect_rc 2
run path-move "$TMP_ROOT/missing.diff" "$ADR"
expect_rc 2
run frobnicate
expect_rc 2
end

begin "footprint: the ADR pattern's anchors, directory and extension each hold"
repo fp-shape
diff_
for hit in other/docs/adr/0009-x.md docs/adr/0009-sub/x.md docs/adr/0009-x.txt docs/adr/009-x.md; do
  case_ctx="$hit"
  run footprint "$DIFF" "$hit"
  expect_rc 1
  expect_stdout 'is not an ADR file'
done
end

begin "footprint: an ADR copied to a new number is not an amendment"
repo fp-copy
cp "$REPO/$ADR" "$REPO/docs/adr/0011-copy.md"
must git -C "$REPO" add -A
git -C "$REPO" diff --cached -C -C >"$DIFF"
grep -q '^copy from' "$DIFF" || bad "fixture: git did not report a copy"
run footprint "$DIFF" docs/adr/0011-copy.md
expect_rc 1
expect_stdout 'is a copy'
end

begin "footprint, plan-named and path-move: a mode-only change to an ADR changes no line"
repo fp-mode
must chmod +x "$REPO/$ADR"
diff_
grep -q '^new mode' "$DIFF" || bad "fixture: git did not report a mode change"
run footprint "$DIFF" "$ADR"
expect_rc 0
printf '## Plan\n' >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 1
expect_stdout 'changes no line'
run path-move "$DIFF" "$ADR"
expect_rc 1
end

begin "path-move: a moved path git C-quotes (a non-ASCII byte) still matches the ADR's span"
repo pm-quoted
q_old=packages/a/src/dépth.ts q_new=packages/b/src/dépth.ts
printf 'export const DEPTH = 1;\n' >"$REPO/$q_old"
sub "$LINE" "  - The depth is owned by \`$q_old\`, and its ledger is declared with it."
must git -C "$REPO" add -A
must git -C "$REPO" commit --quiet -m 'quoted owner'
must mkdir -p "$REPO/packages/b/src"
must git -C "$REPO" mv "$q_old" "$q_new"
sub "  - The depth is owned by \`$q_old\`, and its ledger is declared with it." "  - The depth is owned by \`$q_new\`, and its ledger is declared with it."
entry
diff_
grep -q '^rename from "' "$DIFF" || bad "fixture: git did not quote the path"
run path-move "$DIFF" "$ADR"
expect_rc 0
end

begin "path-move: a new path the PR adds, beside an old one it keeps, is not a move"
repo pm-addonly
must mkdir -p "$REPO/packages/b/src"
printf 'a different file\nof several lines\n' >"$REPO/$NEW"
sub "$LINE" "$MOVED"
entry
diff_
run path-move "$DIFF" "$ADR"
expect_rc 1
expect_stdout "is not a file this PR moves"
end

begin "path-move: an appended block opening with a near-miss entry refuses"
for tail in '  - **2026-11-03 — (f): indented** (#2).' '- **2026-11-03 - (f): a hyphen** (#2).' '- **2026-11-3 — (f): short day** (#2).'; do
  case_ctx="tail '$tail'"
  repo "pm-nearentry-$RANDOM"
  move
  sub "$LINE" "$MOVED"
  printf '%s\n' "$tail" >>"$REPO/$ADR"
  diff_
  run path-move "$DIFF" "$ADR"
  expect_rc 1
  expect_stdout 'not the dated entry appended at the end'
done
end

begin "plan-named: a heading that only starts with Plan is not a plan comment"
repo pn-planning
entry
diff_
{ printf '## Planning notes\n'; sed -n '/^@@/,$p' "$DIFF"; } >"$TMP_ROOT/body"
comment "$TMP_ROOT/plan.json" "$TMP_ROOT/body"
run plan-named "$DIFF" "$TMP_ROOT/plan.json" 560 "$ADR"
expect_rc 1
expect_stdout 'is not a plan comment'
end

# ==========================================================================================
# cite
# ==========================================================================================
PRURL=https://github.com/O/R/pull/600
C=https://github.com/O/R/issues/560#issuecomment-123

begin "cite: one plan comment URL on a closed issue, in the PR's repo, yields its id"
run cite "$PRURL" "- **Verdict**: approved at plan 2026-11-04 — named verbatim in $C" 559 560
expect_rc 0
expect_stdout '123 560'
run cite "$PRURL" "approved at plan — $C, again $C" 560
expect_rc 0
run cite "$PRURL" "approved at plan — ${C/O\/R/o/r}" 560
expect_rc 0
end

begin "cite: no URL, two URLs, another repo, an unclosed issue or a bad PR url refuses"
run cite "$PRURL" "approved at plan 2026-11-04 — PROCEED" 560
expect_rc 1
expect_stdout 'cites 0'
run cite "$PRURL" "$C and https://github.com/O/R/issues/560#issuecomment-124" 560
expect_rc 1
expect_stdout 'cites 2'
run cite "$PRURL" "https://github.com/O/S/issues/560#issuecomment-123" 560
expect_rc 1
expect_stdout 'is in O/S, not O/R'
run cite "$PRURL" "$C" 559 5600
expect_rc 1
expect_stdout 'on #560, which this PR does not close'
run cite "$PRURL" "$C"
expect_rc 1
expect_stdout 'does not close'
run cite "https://github.com/O/R/pull/600/files" "$C" 560
expect_rc 1
expect_stdout 'cannot read the repository'
run cite "$PRURL" "https://github.com/O/R/pull/560#issuecomment-123" 560
expect_rc 1
expect_stdout 'cites 0'
run cite "x $PRURL" "$C" 560
expect_rc 1
expect_stdout 'cannot read the repository'
end

finish
