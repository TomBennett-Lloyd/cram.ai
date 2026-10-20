#!/usr/bin/env bash
# Test harness for fill-verdict.sh, its neighbour in this directory.
#
# git is real: each fixture is a bare origin, a main clone and a lane worktree on the PR's head
# branch. `gh` and `pnpm verify` are stubbed through the subject's env seams. Every refusal case
# asserts that nothing was written, committed or pushed, not only the exit code.
#
# Usage: bash .claude/scripts/fill-verdict.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SUBJECT="$SCRIPTS/fill-verdict.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

PH='pending — filled at merge'
LOG=docs/review-feedback.md
BRANCH=50-lane
STUB="$TMP_ROOT/stub"

# The subject commits with whatever identity git finds, so the fixture supplies one without
# reading or writing the operator's own config.
export GIT_CONFIG_GLOBAL="$TMP_ROOT/gitconfig" GIT_CONFIG_NOSYSTEM=1
must git config --file "$GIT_CONFIG_GLOBAL" user.name test
must git config --file "$GIT_CONFIG_GLOBAL" user.email test@test
must git config --file "$GIT_CONFIG_GLOBAL" commit.gpgsign false
must git config --file "$GIT_CONFIG_GLOBAL" core.hooksPath "$TMP_ROOT/no-hooks"
must git config --file "$GIT_CONFIG_GLOBAL" init.defaultBranch main

must mkdir -p "$STUB"
cat >"$STUB/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/calls.log"
[ "$1 $2" = "pr view" ] && exec cat "$STUB_DIR/view.json"
exit 1
EOF
cat >"$STUB/verify" <<'EOF'
#!/usr/bin/env bash
git status --porcelain >"$STUB_DIR/verify-saw"
[ -n "${VERIFY_STUB_NOROOT-}" ] ||
  echo "verify root: ${VERIFY_STUB_ROOT:-$(git rev-parse --show-toplevel)} [$(git rev-parse --abbrev-ref HEAD)]"
exit "${VERIFY_STUB_RC:-0}"
EOF
must chmod +x "$STUB/gh"
export STUB_DIR="$STUB"
export FILL_VERDICT_GH_CMD="$STUB/gh"
export FILL_VERDICT_VERIFY_CMD="bash $STUB/verify"

ROOT="" WT="" ORIGIN="" HEAD0=""

entry() { # entry <issue> <slug> <category-value> <verdict-value>
  printf '\n## 2026-10-16 — issue #%s — %s\n\n- **Category**: %s\n- **Feedback**: the PR asks the owner to decide: x.\n- **Verdict**: %s\n' \
    "$1" "$2" "$3" "$4"
}

# fixture <name> — main holds the log's header, an older entry, a decoy #51 entry carrying both
# placeholders, an accepted ADR and the template; the lane branch adds the #50 entry. Callers
# edit the lane further, then call `seal`.
fixture() {
  local base="$TMP_ROOT/$1"
  ORIGIN="$base/origin.git"
  ROOT="$base/repo"
  WT="$base/lane"
  must git init -q --bare "$ORIGIN"
  must git init -q "$ROOT"
  must mkdir -p "$ROOT/docs/adr" "$ROOT/.claude"
  printf '{ "feedbackLog": "%s" }\n' "$LOG" >"$ROOT/.claude/workflow.json"
  cat >"$ROOT/$LOG" <<EOF
# Review-feedback log

## Entry format

\`\`\`
## YYYY-MM-DD — [PR/issue #n — ]<short-slug>

- **Category**: $PH
- **Verdict**: $PH
\`\`\`

## Category vocabulary

- **plan** — the shape of a plan.
- **approved-no-changes** — the owner approved with no revisions.
- **other** — fits none of the above.

---
EOF
  entry 7 older plan approved >>"$ROOT/$LOG"
  entry 51 decoy "$PH" "$PH" >>"$ROOT/$LOG"
  # An entry an earlier PR for #50 left unfilled: on main, so never this branch's to fill.
  [ -z "${FIXTURE_OLD_50-}" ] || entry 50 earlier-pr "$PH" "$PH" >>"$ROOT/$LOG"
  printf '# 0000 — Template\n\n- **Status:** proposed | accepted | superseded by NNNN\n\n## Context\n' >"$ROOT/docs/adr/0000-template.md"
  printf '# 0001 — Old\n\n- **Status:** accepted\n\n## Context\n\n- **Status:** proposed\n' >"$ROOT/docs/adr/0001-old.md"
  must git -C "$ROOT" add -A
  must git -C "$ROOT" commit -q -m base
  must git -C "$ROOT" remote add origin "$ORIGIN"
  must git -C "$ROOT" push -q origin HEAD:refs/heads/main
  must git -C "$ROOT" fetch -q origin
  must git -C "$ROOT" worktree add -q -b "$BRANCH" "$WT" origin/main
  entry 50 the-ask "$PH" "$PH" >>"$WT/$LOG"
  view_json "Closes #50"
}

seal() { # seal — commit the lane, push it, and point the gh stub at its head
  must git -C "$WT" add -A
  must git -C "$WT" commit -q -m "#50: lane work"
  must git -C "$WT" push -q origin "HEAD:refs/heads/$BRANCH"
  HEAD0=$(git -C "$WT" rev-parse HEAD)
  view_json "${1-Closes #50}" "$HEAD0"
}

view_json() { # view_json <body> [head-sha] [state]
  printf '{"state":"%s","headRefName":"%s","headRefOid":"%s","baseRefName":"main","body":"%s"}\n' \
    "${3-OPEN}" "$BRANCH" "${2-unset}" "$1" >"$STUB/view.json"
}

run() { # run [env...] -- <args...> — the subject against the current fixture, stub logs reset
  rm -f "$STUB/calls.log" "$STUB/verify-saw"
  capture bash "$SUBJECT" "$@"
}

origin_tip() { git -C "$ORIGIN" rev-parse "refs/heads/$BRANCH"; }

expect_untouched() { # nothing committed, pushed, or left in the tree
  [ "$(git -C "$WT" rev-parse HEAD)" = "$HEAD0" ] || bad "HEAD moved"
  [ "$(origin_tip)" = "$HEAD0" ] || bad "origin moved"
  [ -z "$(git -C "$WT" status --porcelain)" ] || bad "tree not clean: $(git -C "$WT" status --porcelain)"
}

placeholders_in() { grep -cF -- "$PH" "$1"; }

# --- the clean path --------------------------------------------------------------------------

begin 'parses under every bash'
expect_parses "$SUBJECT"
end

for b in $BASHES; do
  begin "clean path, no ADR: fills #50 only, verifies, commits, pushes (under $b)"
  fixture "clean-${b//\//-}"
  seal
  rm -f "$STUB/calls.log" "$STUB/verify-saw"
  capture "$b" "$SUBJECT" 50 --category approved-no-changes --verdict 'approved in chat — "ok"' "$ROOT"
  expect_rc 0
  grep -qxF -- '- **Category**: approved-no-changes' "$WT/$LOG" || bad "Category not filled"
  grep -qxF -- '- **Verdict**: approved in chat — "ok"' "$WT/$LOG" || bad "Verdict not filled"
  # Header's two quoted placeholders and the #51 decoy's two survive.
  [ "$(placeholders_in "$WT/$LOG")" = 4 ] || bad "expected 4 placeholder lines left, got $(placeholders_in "$WT/$LOG")"
  [ "$(git -C "$WT" log -1 --format=%B)" = "#50: verdict — approved-no-changes" ] ||
    bad "message: $(git -C "$WT" log -1 --format=%B)"
  [ "$(git -C "$WT" diff --name-only HEAD~1 HEAD)" = "$LOG" ] || bad "commit touched more than the log"
  [ "$(origin_tip)" = "$(git -C "$WT" rev-parse HEAD)" ] || bad "not pushed"
  [ -z "$(git -C "$WT" status --porcelain)" ] || bad "tree left dirty"
  grep -qF "$LOG" "$STUB/verify-saw" 2>/dev/null || bad "verify did not run on the filled tree"
  expect_stdout "verify root: $WT [$BRANCH]"
  end
done

begin 'ADR flip: the added proposed ADR is accepted; main-only and template ADRs untouched'
fixture adr
printf '# 0007 — New\n\n- **Status:** proposed\n\n## Context\n\n- **Status:** proposed\n' >"$WT/docs/adr/0007-new.md"
printf 'A template edit.\n' >>"$WT/docs/adr/0000-template.md"
seal
old_template=$(cat "$WT/docs/adr/0000-template.md")
old_0001=$(cat "$WT/docs/adr/0001-old.md")
run 50 --category approved-no-changes --verdict 'approved' "$ROOT"
expect_rc 0
[ "$(sed -n 3p "$WT/docs/adr/0007-new.md")" = '- **Status:** accepted' ] || bad "0007 not flipped"
[ "$(sed -n 7p "$WT/docs/adr/0007-new.md")" = '- **Status:** proposed' ] || bad "a Status below the header was rewritten"
[ "$(cat "$WT/docs/adr/0001-old.md")" = "$old_0001" ] || bad "0001 changed"
[ "$(cat "$WT/docs/adr/0000-template.md")" = "$old_template" ] || bad "the template changed"
[ "$(git -C "$WT" log -1 --format=%s)" = "#50: verdict — approved-no-changes; ADR 0007 accepted" ] ||
  bad "subject: $(git -C "$WT" log -1 --format=%s)"
end

begin 'amendment: a modified accepted ADR is left as it is; the entry is still filled'
fixture amend
printf '\n## Amendments\n\n- 2026-10-20: 3 → 4 (#57).\n' >>"$WT/docs/adr/0001-old.md"
seal
amended=$(cat "$WT/docs/adr/0001-old.md")
run 50 --category approved-no-changes --verdict approved --no-push "$ROOT"
expect_rc 0
[ "$(cat "$WT/docs/adr/0001-old.md")" = "$amended" ] || bad "the amended ADR was rewritten"
grep -qxF -- '- **Verdict**: approved' "$WT/$LOG" || bad "Verdict not filled"
[ "$(git -C "$WT" log -1 --format=%s)" = "#50: verdict — approved-no-changes" ] ||
  bad "subject: $(git -C "$WT" log -1 --format=%s)"
expect_stdout 'entry filled; ADR 0001 left accepted'
end

begin 'supersession: the new ADR is accepted; the superseded one is left as it is'
fixture supersede
printf '# 0007 — New\n\n- **Status:** proposed\n\n## Context\n' >"$WT/docs/adr/0007-new.md"
perl -pi -e 's/^- \*\*Status:\*\* accepted$/- **Status:** superseded by 0007/ if $. == 3' "$WT/docs/adr/0001-old.md"
seal
superseded=$(cat "$WT/docs/adr/0001-old.md")
run 50 --category approved-no-changes --verdict approved --no-push "$ROOT"
expect_rc 0
[ "$(sed -n 3p "$WT/docs/adr/0007-new.md")" = '- **Status:** accepted' ] || bad "0007 not flipped"
[ "$(cat "$WT/docs/adr/0001-old.md")" = "$superseded" ] || bad "the superseded ADR was rewritten"
[ "$(sed -n 3p "$WT/docs/adr/0001-old.md")" = '- **Status:** superseded by 0007' ] || bad "fixture edit missed"
[ "$(git -C "$WT" log -1 --format=%s)" = "#50: verdict — approved-no-changes; ADR 0007 accepted" ] ||
  bad "subject: $(git -C "$WT" log -1 --format=%s)"
expect_stdout 'ADR 0007 accepted; ADR 0001 left superseded by 0007'
end

begin 'a modified proposed ADR is flipped like an added one'
fixture adrmodified
must git -C "$ROOT" checkout -q main
printf '# 0009 — Pending\n\n- **Status:** proposed\n' >"$ROOT/docs/adr/0009-pending.md"
must git -C "$ROOT" add -A
must git -C "$ROOT" commit -q -m 'merged unflipped'
must git -C "$ROOT" push -q origin HEAD:refs/heads/main
must git -C "$WT" fetch -q origin
must git -C "$WT" -c core.commentChar=';' -c commit.cleanup=strip merge -q --no-edit origin/main
printf 'Revised.\n' >>"$WT/docs/adr/0009-pending.md"
seal
run 50 --category approved-no-changes --verdict approved --no-push "$ROOT"
expect_rc 0
[ "$(sed -n 3p "$WT/docs/adr/0009-pending.md")" = '- **Status:** accepted' ] || bad "0009 not flipped"
expect_stdout 'ADR 0009 accepted'
end

begin 'a parenthesised qualifier after a listed category is accepted verbatim'
fixture qualifier
seal
run 50 --category 'other (verification rigour)' --verdict 'approved' --no-push "$ROOT"
expect_rc 0
grep -qxF -- '- **Category**: other (verification rigour)' "$WT/$LOG" || bad "qualified category not written"
end

begin 'no Closes line: the issue comes from the head branch number'
fixture branchnum
seal 'no closing keyword here'
run 50 --category plan --verdict 'revised' --no-push "$ROOT"
expect_rc 0
[ "$(git -C "$WT" log -1 --format=%s)" = "#50: verdict — plan" ] || bad "subject: $(git -C "$WT" log -1 --format=%s)"
end

begin 'an entry headed PR #<pr> is found; the subject still takes the issue number'
fixture prheading
must git -C "$WT" checkout -q -- "$LOG"
printf '\n## 2026-10-16 — PR #77 — the-ask\n\n- **Category**: %s\n- **Verdict**: %s\n' "$PH" "$PH" >>"$WT/$LOG"
seal
run 77 --category plan --verdict 'revised' --no-push "$ROOT"
expect_rc 0
grep -qxF -- '- **Verdict**: revised' "$WT/$LOG" || bad "the PR-headed entry was not filled"
[ "$(git -C "$WT" log -1 --format=%s)" = "#50: verdict — plan" ] || bad "subject: $(git -C "$WT" log -1 --format=%s)"
end

begin 'placeholder lines inside a fence in the entry are not the fields'
fixture fence
must git -C "$WT" checkout -q -- "$LOG"
fence=$(printf '\140\140\140')
example=$(printf '%s\n- **Category**: %s\n- **Verdict**: %s\n%s' "$fence" "$PH" "$PH" "$fence")
printf '\n## 2026-10-16 — issue #50 — the-ask\n\n- **Category**: %s\n\n%s\n\n- **Verdict**: %s\n\n%s\n' \
  "$PH" "$example" "$PH" "$example" >>"$WT/$LOG"
seal
run 50 --category plan --verdict 'revised' --no-push "$ROOT"
expect_rc 0
[ "$(grep -A2 -F 'issue #50 — the-ask' "$WT/$LOG" | tail -n 1)" = '- **Category**: plan' ] || bad "the real Category was not filled"
[ "$(grep -A9 -F 'issue #50 — the-ask' "$WT/$LOG" | tail -n 1)" = '- **Verdict**: revised' ] || bad "the real Verdict was not filled"
# Header two, decoy two, and the four fenced lines.
[ "$(placeholders_in "$WT/$LOG")" = 8 ] || bad "a fenced placeholder was filled: $(placeholders_in "$WT/$LOG") left"
end

begin 'an unfilled #50 entry already on main is left alone; the branch-added one is filled'
FIXTURE_OLD_50=1 fixture old50
seal
run 50 --category plan --verdict 'revised' --no-push "$ROOT"
expect_rc 0
grep -A4 -F 'earlier-pr' "$WT/$LOG" | grep -qF -- "- **Verdict**: $PH" || bad "the main entry was filled"
grep -A4 -F 'the-ask' "$WT/$LOG" | grep -qxF -- '- **Verdict**: revised' || bad "the branch entry was not filled"
end

begin '--no-push commits and leaves origin where it was'
fixture nopush
seal
run 50 --category plan --verdict 'revised' --no-push "$ROOT"
expect_rc 0
[ "$(origin_tip)" = "$HEAD0" ] || bad "origin moved under --no-push"
[ "$(git -C "$WT" rev-parse HEAD~1)" = "$HEAD0" ] || bad "no commit on top of the head"
expect_stdout 'skipped (--no-push)'
end

# --- refusals: nothing written ---------------------------------------------------------------

begin 'refuses when no #50 entry carries the placeholders'
fixture missing
must git -C "$WT" checkout -q -- "$LOG"
printf 'unrelated\n' >"$WT/notes.md"
seal
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr '0 entries this branch added headed issue #50'
expect_untouched
[ ! -e "$STUB/verify-saw" ] || bad "verify ran after a refusal"
end

begin 'refuses two #50 entries carrying both placeholders'
fixture two
entry 50 second-ask "$PH" "$PH" >>"$WT/$LOG"
seal
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr '2 entries this branch added headed issue #50'
expect_untouched
end

begin 'refuses a half-filled entry'
fixture half
must git -C "$WT" checkout -q -- "$LOG"
entry 50 the-ask plan "$PH" >>"$WT/$LOG"
seal
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'one placeholder, not both'
expect_untouched
end

begin 'refuses a category the log does not list'
fixture badcat
seal
run 50 --category approved --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'category "approved" is not one'
expect_stderr 'plan, approved-no-changes, other'
expect_untouched
end

begin 'refuses a dirty worktree'
fixture dirty
seal
printf 'stray\n' >"$WT/stray.txt"
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'is not clean'
[ "$(placeholders_in "$WT/$LOG")" = 6 ] || bad "the log was written"
[ "$(git -C "$WT" rev-parse HEAD)" = "$HEAD0" ] || bad "HEAD moved"
end

begin 'refuses a worktree not on the head branch'
fixture wrongbranch
seal
run 50 --category approved-no-changes --verdict approved --worktree "$ROOT" "$ROOT"
expect_rc 1
expect_stderr "not the PR's head branch '$BRANCH'"
expect_untouched
end

begin "refuses a worktree whose tip is not the PR's head"
fixture tip
seal
view_json 'Closes #50' 0000000000000000000000000000000000000000
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr "but the PR's head is 0000000"
expect_untouched
end

# An added ADR is proposed until the fill accepts it; a modified one may already stand (#57).
begin 'refuses an added ADR that is not proposed, writing nothing at all'
fixture adradded
printf '# 0007 — New\n\n- **Status:** accepted\n\n## Context\n' >"$WT/docs/adr/0007-new.md"
seal
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'docs/adr/0007-new.md is added by this PR and reads "- **Status:** accepted"'
[ "$(placeholders_in "$WT/$LOG")" = 6 ] || bad "the log was written before the ADR refusal"
expect_untouched
end

for value in 'superseded by 7' 'superseded by 00070' 'superseded by NNNN' 'superseded by 0007 in part' \
  'partly superseded by 0007' 'accepted in part' 'not accepted' 'Accepted'; do
  begin "refuses a modified ADR whose Status reads '$value'"
  fixture "adrvalue-${value//[^a-zA-Z0-9]/-}"
  perl -pi -e "s/^- \\*\\*Status:\\*\\* accepted\$/- **Status:** $value/ if \$. == 3" "$WT/docs/adr/0001-old.md"
  [ "$(sed -n 3p "$WT/docs/adr/0001-old.md")" = "- **Status:** $value" ] || bad "fixture edit missed"
  seal
  run 50 --category approved-no-changes --verdict approved "$ROOT"
  expect_rc 1
  expect_stderr "docs/adr/0001-old.md reads \"- **Status:** $value\"; a modified ADR is"
  expect_untouched
  end
done

begin 'refuses an ADR not named NNNN-<slug>.md before writing anything'
fixture adrname
printf '# 0008\n\n- **Status:** proposed\n' >"$WT/docs/adr/0008.md"
seal
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'docs/adr/0008.md is not named docs/adr/NNNN-<slug>.md'
expect_untouched
end

begin 'refuses several Closes lines that do not include the branch number'
fixture closes
seal 'Closes #60. Closes #61.'
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'cannot tell which issue'
expect_untouched
end

begin 'refuses a PR that is not OPEN'
fixture merged
seal
view_json 'Closes #50' "$HEAD0" MERGED
run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr "is 'MERGED', not OPEN"
expect_untouched
end

begin 'a red verify restores the tree and commits nothing'
fixture red
seal
VERIFY_STUB_RC=1 run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stdout 'verify — rc=1'
expect_stderr 'tree restored'
grep -qF "$LOG" "$STUB/verify-saw" 2>/dev/null || bad "verify did not see the fill"
expect_untouched
end

begin 'a verify root naming another tree restores the tree and commits nothing'
fixture otherroot
seal
VERIFY_STUB_ROOT=/elsewhere run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr "does not name $WT"
expect_untouched
end

begin 'a verify with no root line restores the tree and commits nothing'
fixture noroot
seal
VERIFY_STUB_NOROOT=1 run 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stdout 'no verify root line'
expect_untouched
end

begin 'usage errors exit 2'
fixture usage
seal
run 50 --category plan "$ROOT"
expect_rc 2
run abc --category plan --verdict x "$ROOT"
expect_rc 2
run 50 --category plan --verdict "$PH" "$ROOT"
expect_rc 2
expect_untouched
end

# --- the commit flags --------------------------------------------------------------------------

# mutant <name> <perl-substitution> <text-that-must-be-gone> -> MUTANT, a copy of the subject
mutant() {
  local dir="$TMP_ROOT/mutant-$1"
  must mkdir -p "$dir"
  must cp "$SUBJECT" "$SCRIPTS/worktree-lib.sh" "$dir/"
  must perl -pi -e "$2" "$dir/fill-verdict.sh"
  fixture_lacks "$dir/fill-verdict.sh" "$3"
  MUTANT="$dir/fill-verdict.sh"
}

begin 'mutant without core.commentChar: strip deletes the #50 subject and the run refuses'
mutant nochar "s/ -c core\\.commentChar=';'//" "commentChar"
fixture nochar
seal
capture bash "$MUTANT" 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr 'git commit failed'
expect_untouched
end

# The strip-less mutant cannot leak a ';' template line: the subject's one commit is `commit -m`,
# which loads no template and opens no editor, and it never rebases. So the case shows the
# mutant's commit clean under GIT_EDITOR=true, then pins both flags in the real script's text.
begin 'mutant without commit.cleanup=strip leaks nothing (no editor, no rebase); both flags pinned'
mutant nostrip "s/ -c commit\\.cleanup=strip//" "commit.cleanup=strip"
fixture nostrip
seal
GIT_EDITOR=true capture bash "$MUTANT" 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 0
[ "$(git -C "$WT" log -1 --format=%B)" = "#50: verdict — approved-no-changes" ] ||
  bad "mutant's message: $(git -C "$WT" log -1 --format=%B)"
grep -qF -- "-c core.commentChar=';' -c commit.cleanup=strip commit -m" "$SUBJECT" ||
  bad "the subject's commit lacks the flag pair"
end

# --- the ADR record guard ------------------------------------------------------------------------

# The node pass prints only numbers it has already matched, so the shell's guard on its records is
# reached by a mutant of that pass alone.
begin "mutant whose node pass prints a non-number: the record is refused and the tree restored"
mutant badnum 's/"accepted\\t" \+ num\)/"accepted\\t" + num + "x")/' '"accepted\t" + num)'
fixture badnum
printf '# 0007 — New\n\n- **Status:** proposed\n' >"$WT/docs/adr/0007-new.md"
seal
capture bash "$MUTANT" 50 --category approved-no-changes --verdict approved "$ROOT"
expect_rc 1
expect_stderr "node printed 'accepted	0007x' where an ADR record belongs; tree restored"
expect_untouched
end

finish
