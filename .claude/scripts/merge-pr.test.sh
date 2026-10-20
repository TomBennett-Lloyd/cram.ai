#!/usr/bin/env bash
# Test harness for merge-pr.sh, its neighbour in this directory.
#
# The assertion vocabulary is harness-lib.sh next door. The subject's entire input
# is what GitHub says about a PR, so `gh` is stubbed — the WORKTREE_GH_CMD seam in
# worktree-lib.sh is the precedent, and MERGE_PR_GH_CMD is the same idea. The stub
# is a state directory rather than a fixed answer: `pr view` serves a SEQUENCE
# (view.1, view.2, … falling back to view.default), and once `pr merge` has been
# called it serves view.merged instead. That is what makes ordering assertable —
# "the label came off after the merge" is a claim about two calls, not about one.
#
# Everything the stub is asked is appended to calls.log, so a case can assert both
# what was called and what was NOT. The negative assertions are the load-bearing
# half here: a refusal that still merged would pass every positive assertion.
#
# What the fixtures do NOT stub is git. The repository the subject is pointed at is
# a real one, because the worktree step reads `git worktree list --porcelain` and a
# stub for that is a stub for the thing under test. reap-worktree.sh IS stubbed —
# it has its own harness (worktree-lifecycle.test.sh) and re-testing its guards
# here would assert the same thing twice; what these cases assert is the
# DELEGATION, and the one decision merge-pr.sh makes before it: never the caller's
# own working directory.
#
# The bias every case is written against: this script can only be wrong in one
# direction. Refusing a merge that should have happened costs a re-run. Merging one
# that should have been refused — on a red check, on an unfilled verdict, on a
# BEHIND head — is a defect nobody can take back, which is why every refusal case
# asserts the absence of `pr merge` in calls.log rather than only the exit code.
#
# Usage: bash .claude/scripts/merge-pr.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SUBJECT="$SCRIPTS/merge-pr.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

PR=490
HEAD_REF=490-lane
HUMAN_ALWAYS_DEFAULT='["docs/adr/**",".claude/workflow.json","CLAUDE.md"]'

# `gh pr update-branch`'s two answers, and the only distinction the subject draws
# between them: the no-op it prints when the branch is already current, and
# anything else, which means it wrote a merge commit onto the branch.
UPDATE_NOOP='PR branch already up-to-date'
UPDATE_WROTE="Updated branch $HEAD_REF"
# The third answer, and the one the append-only-log union cases turn on: GitHub
# answers a 422 when the base and the head both changed the same region.
UPDATE_CONFLICT='failed to update branch: merge conflict between base and head'

# The tech-debt log's path, spelled once here so a case that changes it changes it
# everywhere — including in the assertions about what came out.
TD='docs/tech-debt.md'

ROOT=""
STATE=""
REPO=""

# Identity is passed per-command: the harness must not depend on (or write) any git config.
gitc() {
  local dir="$1"
  shift
  git -C "$dir" -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"
}

# --- the JSON a `gh pr view --json` answer is made of ---------------------------------------
#
# Held in V_* globals rather than passed as eight positional arguments: a case that
# changes one field should say which one, and `V_CHECKS="ci:COMPLETED:FAILURE"` is
# the whole of what a red-check case differs by.

V_STATE=""
V_MSST=""
V_OID=""
V_LABELS=""
V_FILES=""
V_CHECKS=""
V_COMMITS=""
V_BODY=""
V_BASE_REF=""

reset_view() {
  V_STATE="OPEN"
  V_MSST="CLEAN"
  V_OID="aaa111"
  V_BASE_REF="main"
  V_LABELS=""
  V_FILES="docs/notes.md"
  V_CHECKS="checks:COMPLETED:SUCCESS,gitleaks:COMPLETED:SUCCESS"
  V_COMMITS="#12: the change"
  V_BODY="What and why. Closes #12"
}

# json_objects <key> <comma-separated values> -> [{"<key>":"v"},…]
# A here-doc-fed read loop rather than IFS word splitting: the values carry spaces
# (commit subjects do), and splitting on whitespace would silently shard them.
json_objects() {
  local key="$1" first=1 v
  printf '['
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    [ "$first" = "1" ] || printf ','
    printf '{"%s":"%s"}' "$key" "$v"
    first=0
  done <<EOF
$(printf '%s' "$2" | tr ',' '\n')
EOF
  printf ']'
}

# json_checks <comma-separated name:status:conclusion[@startedAt[@workflowName]]> -> the
# statusCheckRollup array. An empty conclusion is spelled by leaving the third field empty
# ("web-e2e:IN_PROGRESS:"), which is exactly how GitHub answers for a check that has not
# finished. startedAt and workflowName follow `@` because a timestamp carries colons; they
# default to empty and "CI", which is what tells two runs of one job apart from two jobs.
json_checks() {
  local first=1 spec name rest status conclusion started workflow
  printf '['
  while IFS= read -r spec; do
    [ -n "$spec" ] || continue
    started=""
    workflow="CI"
    case "$spec" in
      *@*@*)
        workflow=${spec##*@}
        started=${spec#*@}
        started=${started%@*}
        ;;
      *@*) started=${spec#*@} ;;
    esac
    spec=${spec%%@*}
    name=${spec%%:*}
    rest=${spec#*:}
    status=${rest%%:*}
    conclusion=${rest#*:}
    [ "$first" = "1" ] || printf ','
    printf '{"__typename":"CheckRun","name":"%s","status":"%s","conclusion":"%s","startedAt":"%s","workflowName":"%s"}' \
      "$name" "$status" "$conclusion" "$started" "$workflow"
    first=0
  done <<EOF
$(printf '%s' "$1" | tr ',' '\n')
EOF
  printf ']'
}

pr_json() {
  printf '{"number":%s,"state":"%s","url":"https://example.test/pull/%s",' "$PR" "$V_STATE" "$PR"
  printf '"baseRefName":"%s",' "$V_BASE_REF"
  printf '"headRefName":"%s","headRefOid":"%s","mergeStateStatus":"%s","body":"%s",' \
    "$HEAD_REF" "$V_OID" "$V_MSST" "$V_BODY"
  printf '"labels":'
  json_objects name "$V_LABELS"
  # `files` is present here and the subject must IGNORE it — GitHub still answers
  # the field, capped at 100. Case 17b is what proves the ignoring: only the api
  # list carries the humanAlways path there, and the run still comes out HUMAN.
  printf ',"files":'
  json_objects path "$V_FILES"
  printf ',"commits":'
  json_objects messageHeadline "$V_COMMITS"
  printf ',"statusCheckRollup":'
  json_checks "$V_CHECKS"
  printf '}\n'
}

write_view() { # write_view <slot: default|1|2|…|merged>
  pr_json >"$STATE/view.$1"
  # The changed-file list is NOT part of the `pr view` answer — the subject reads
  # it through a paginated `gh api …/files` call, because `--json files` caps at
  # 100 with no truncation signal. It is refreshed here so a case sets V_FILES
  # once and both reads agree.
  printf '%s' "$V_FILES" | tr ',' '\n' >"$STATE/files"
}

# write_merged_view — the answer the stub serves once `pr merge` has been called.
# MERGED PRs really do report mergeStateStatus UNKNOWN (verified against cumulo#489),
# so the fixture says so: a subject that read that field after the merge would be
# reading a value that means nothing, and this is what makes that a red case.
write_merged_view() {
  local keep_state="$V_STATE" keep_msst="$V_MSST"
  V_STATE="MERGED"
  V_MSST="UNKNOWN"
  write_view merged
  V_STATE="$keep_state"
  V_MSST="$keep_msst"
}

# --- stubs ------------------------------------------------------------------------------------

gh_stub() { # gh_stub <path> <state dir>
  cat >"$1" <<EOF
#!/usr/bin/env bash
state="$2"
printf '%s\n' "\$*" >>"\$state/calls.log"
case "\$1 \$2" in
  "api "*)
    [ -f "\$state/files" ] && cat "\$state/files"
    rc=0
    [ -f "\$state/files.rc" ] && read -r rc <"\$state/files.rc"
    exit "\$rc"
    ;;
  "pr view")
    if [ -f "\$state/merged" ] && [ -f "\$state/view.merged" ]; then
      cat "\$state/view.merged"
      exit 0
    fi
    n=0
    [ -f "\$state/view.count" ] && read -r n <"\$state/view.count"
    n=\$((n + 1))
    printf '%s' "\$n" >"\$state/view.count"
    # A request that never answers, held for as many seconds as the file says; exec,
    # so that the subject's time box kills the sleep itself and leaves no orphan.
    # box.fire is what lets sleep_stub's watchdog fire on this call and no other.
    # A .delay is the opposite: a call that answers, only late.
    [ -f "\$state/view.\$n.delay" ] && sleep "\$(cat "\$state/view.\$n.delay")"
    if [ -f "\$state/view.\$n.hang" ]; then
      : >"\$state/box.fire"
      exec sleep "\$(cat "\$state/view.\$n.hang")"
    fi
    slot="\$state/view.\$n"
    [ -f "\$slot" ] || slot="\$state/view.default"
    if [ -f "\$state/view.\$n.oid-from-wt" ]; then
      # The one headRefOid a fixture cannot write ahead of time: the sha the union step
      # committed during this very run. Substituted from the lane worktree at call time,
      # which is what lets a case assert what the await gate compares against.
      real=\$(git -C "$ROOT/wt" rev-parse HEAD)
      sed "s/\"headRefOid\":\"[^\"]*\"/\"headRefOid\":\"\$real\"/" "\$slot"
    else
      cat "\$slot"
    fi
    rc=0
    [ -f "\$state/view.\$n.rc" ] && read -r rc <"\$state/view.\$n.rc"
    exit "\$rc"
    ;;
  "pr diff")
    [ -f "\$state/diff" ] && cat "\$state/diff"
    exit 0
    ;;
  "pr update-branch")
    # A SEQUENCE, for the same reason \`pr view\` is one: the union step resolves a
    # conflict and then RESUMES here, so "conflict, then already-up-to-date" is a claim
    # about two calls. update-branch.1, update-branch.2, … fall back to update-branch.out.
    n=0
    [ -f "\$state/ub.count" ] && read -r n <"\$state/ub.count"
    n=\$((n + 1))
    printf '%s' "\$n" >"\$state/ub.count"
    if [ -f "\$state/update-branch.\$n.hang" ]; then
      : >"\$state/box.fire"
      exec sleep "\$(cat "\$state/update-branch.\$n.hang")"
    fi
    if [ -f "\$state/update-branch.\$n" ]; then
      cat "\$state/update-branch.\$n"
      rc=0
      [ -f "\$state/update-branch.\$n.rc" ] && read -r rc <"\$state/update-branch.\$n.rc"
      exit "\$rc"
    fi
    [ -f "\$state/update-branch.out" ] && cat "\$state/update-branch.out"
    rc=0
    [ -f "\$state/update-branch.rc" ] && read -r rc <"\$state/update-branch.rc"
    exit "\$rc"
    ;;
  "pr merge")
    : >"\$state/merged"
    exit 0
    ;;
  "pr edit")
    : >"\$state/label-edited"
    exit 0
    ;;
  "issue view")
    if [ -f "\$state/issue.\$3" ]; then
      cat "\$state/issue.\$3"
    else
      printf '{"number":%s,"state":"CLOSED"}\n' "\$3"
    fi
    exit 0
    ;;
esac
printf 'gh stub: unexpected call: %s\n' "\$*" >&2
exit 1
EOF
  must chmod +x "$1"
}

reap_stub() { # reap_stub <path> <state dir>
  cat >"$1" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$2/reap.log"
printf 'REAPED %s (stub)\n' "\$1"
EOF
  must chmod +x "$1"
}

# prettier is stubbed for the same reason reap-worktree.sh is: what these cases assert
# is that the union step RUNS it, over the file it resolved, before it commits — not
# that prettier formats markdown, which prettier's own tests own. It logs its argv and
# leaves the file alone, so a case can also assert the union content byte for byte
# without a formatter rewriting it first.
prettier_stub() { # prettier_stub <path> <state dir>
  cat >"$1" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$2/prettier.log"
if [ -f "$2/prettier.inject" ]; then
  # A formatter that hands back a file with conflict markers in it. Nothing real does
  # this; what it proves is that the marker sweep runs AFTER the formatter and not
  # before it, which no case could otherwise tell — the union is built from verbatim
  # slices of the three blobs plus a head region merge-file only hands back on exit 0,
  # so it can never grow a marker on its own.
  printf '<<<<<<< left behind by the formatter\n' >>"\$2"
fi
rc=0
[ -f "$2/prettier.rc" ] && read -r rc <"$2/prettier.rc"
exit "\$rc"
EOF
  must chmod +x "$1"
}

# sleep, for the cases that hang a call (issue #152). gh_call's watchdog is
# `sleep "$MERGE_PR_GH_TIMEOUT_SECONDS"`; this stub stands in for it and returns when
# gh_stub's hang arm leaves box.fire, so the box fires at the hung call and no other.
# Every other sleep, the hang itself included, is the real one.
sleep_stub() { # sleep_stub <dir to hold it> <state dir>
  local real
  real=$(command -v sleep) || exit 2
  must mkdir -p "$1"
  cat >"$1/sleep" <<EOF
#!/usr/bin/env bash
[ "\$*" = "\$MERGE_PR_GH_TIMEOUT_SECONDS" ] || exec "$real" "\$@"
until [ -e "$2/box.fire" ]; do "$real" 0.05; done
rm -f "$2/box.fire"
EOF
  must chmod +x "$1/sleep"
}

# --- fixtures ---------------------------------------------------------------------------------

fixture() { # fixture <name> [humanAlways JSON array]
  ROOT="$TMP_ROOT/$1"
  STATE="$ROOT/state"
  REPO="$ROOT/repo"
  must mkdir -p "$STATE" "$REPO/.claude"
  must git init --quiet -b main "$REPO"
  must printf '{"merge":{"humanAlways":%s}}\n' "${2:-$HUMAN_ALWAYS_DEFAULT}" >"$REPO/.claude/workflow.json"
  must gitc "$REPO" add -A
  must gitc "$REPO" commit --quiet -m base
  gh_stub "$ROOT/gh" "$STATE"
  reap_stub "$ROOT/reap" "$STATE"
  prettier_stub "$ROOT/prettier" "$STATE"
  sleep_stub "$ROOT/clock" "$STATE"
  : >"$STATE/calls.log"
  # The no-op is the default answer, so that a case saying "updated" has to move
  # headRefOid on the reads that follow — an update that reports a write and
  # leaves the head where it was is a state GitHub does not produce, and the
  # subject now refuses it (case 12c).
  must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
  reset_view
}

reset_calls() { # a second run of the subject against the same state, from the top
  : >"$STATE/calls.log"
  must rm -f "$STATE/view.count" "$STATE/ub.count"
}

POLL_TIMEOUT=30
GH_TIMEOUT=60
FAKE_BOX="" # non-empty: the watchdog's sleep is sleep_stub's, which fires only at a hang

run_merge() { # run_merge [caller's working directory]
  capture -C "${1:-$REPO}" env \
    PATH="${FAKE_BOX:+$ROOT/clock:}$PATH" \
    MERGE_PR_GH_CMD="$ROOT/gh" \
    MERGE_PR_REAP_CMD="$ROOT/reap" \
    MERGE_PR_PRETTIER_CMD="$ROOT/prettier" \
    MERGE_PR_POLL_INTERVAL_SECONDS=0 \
    MERGE_PR_POLL_TIMEOUT_SECONDS="$POLL_TIMEOUT" \
    MERGE_PR_RETRY_SECONDS=0 \
    MERGE_PR_UPDATE_RETRIES=3 \
    MERGE_PR_CONFIRM_RETRIES=2 \
    MERGE_PR_READ_RETRIES=2 \
    MERGE_PR_GH_TIMEOUT_SECONDS="$GH_TIMEOUT" \
    bash "$SUBJECT" "$PR" "$REPO"
}

called() { # called <exact calls.log line>
  grep -qxF -- "$1" "$STATE/calls.log"
}

expect_called() {
  called "$1" || bad "gh was never called as: $1 (log: $(tr '\n' '|' <"$STATE/calls.log"))"
}

expect_not_called() {
  ! called "$1" || bad "gh should not have been called as: $1"
}

call_line() { # call_line <prefix> -> 1-based line number of the first matching call, or 0
  local n
  n=$(grep -n -- "^$1" "$STATE/calls.log" | head -1 | cut -d: -f1)
  printf '%s\n' "${n:-0}"
}

# --- the append-only-log union fixtures --------------------------------------------------------
#
# These cases need MORE git than the rest of the file, not less. The union step
# fetches a base, runs merge-tree, merges in the lane's worktree, commits and pushes
# with a lease — stubbing any of that would stub the thing under test — so the fixture
# grows a real bare origin and a real lane worktree, and the assertions read what came
# out of the push rather than what the subject said it did.

TD_BASE='# Tech-debt log

How this log is kept.

## 2026-09-01 — the entry that was already here

- Where: somewhere
- Source: #1
'

TD_MAIN_ENTRY='
## 2026-09-11 — the entry another lane merged first

- Where: main
- Source: #2
'

TD_BRANCH_ENTRY='
## 2026-09-11 — the entry this lane logged

- Where: the branch
- Source: #3
'

# The same log with its HEADER edited — above the first "## " heading, nowhere near the
# tail the two lanes collide on. This is the shape cumulo#524 was refused over (issue
# cumulo#525): an earlier merge had added a restatement ledger to main, so the whole-blob
# test saw main diverge from the merge base and refused a tail-only conflict.
TD_BASE_LEDGERED='# Tech-debt log

How this log is kept. Restatement ledger: the executable carrier is merge-pr.sh.

## 2026-09-01 — the entry that was already here

- Where: somewhere
- Source: #1
'

# And the same header line moved a DIFFERENT way, so that the two edits collide in the
# header itself. Same line, incompatible text: refused exactly as loudly as the one
# above is admitted.
TD_BASE_LEDGERED_OTHERWISE='# Tech-debt log

How this log is kept. Restatement ledger: nobody has classified the prose carriers.

## 2026-09-01 — the entry that was already here

- Where: somewhere
- Source: #1
'

# Entries are matched by heading, so these three move one: a side that retitled the
# final entry (20s), a base that repeats a heading (20t), and a side that appends a
# second copy of one (20u).
TD_BASE_RENAMED='# Tech-debt log

How this log is kept.

## 2026-09-01 — #1 — the entry that was already here

- Where: somewhere
- Source: #1
'

TD_BASE_DOUBLED='# Tech-debt log

How this log is kept.

## 2026-09-01 — the entry that was already here

- Where: somewhere
- Source: #1

## 2026-09-01 — the entry that was already here

- Where: somewhere else
- Source: #4
'

TD_BRANCH_ENTRY_REUSING_HEADING='
## 2026-09-01 — the entry that was already here

- Where: the branch
- Source: #3
'

# Two more logs for the cases that are not about docs/tech-debt.md. Each carries an
# `Entry format` fence holding a "## " line, as the real files do, so every case over
# them also asserts that fenced text is not read as an entry heading.
RF='docs/review-feedback.md'
FL='docs/friction-log.md'

RF_KEPT='# Review-feedback log

How this log is kept.

## Entry format

```
## YYYY-MM-DD — [PR/issue #n — ]<short-slug>
```

## 2026-10-01 — PR #1 — the entry that was already here

- **Category**: plan
- **Verdict**: approved
'

RF_DOOMED='
## 2026-10-02 — PR #2 — the entry main deletes

- **Category**: plan
- **Verdict**: approved
'

RF_DOOMED_EDITED='
## 2026-10-02 — PR #2 — the entry main deletes

- **Category**: plan
- **Verdict**: approved, and the branch adds a note to it
'

RF_BASE="$RF_KEPT$RF_DOOMED"

RF_MAIN_ENTRY='
## 2026-10-16 — PR #3 — the entry another lane merged first

- **Category**: plan
'

# Its fence quotes a heading the base already has: read as a heading, it would be a
# second copy and refuse the union.
RF_BRANCH_ENTRY='
## 2026-10-16 — PR #4 — the entry this lane logged

- **Category**: convention
- **Feedback**: quote the heading, as in

```
## 2026-10-01 — PR #1 — the entry that was already here
```
'

# PR #61's rebase, in miniature: the branch consumed the PR #32 entry whole and the
# PR #48 entry in part, while main appended PR #58's.
FL_HEAD='# Friction log

Entry format:

```
## YYYY-MM-DD — PR #n
- Phase: planning | implementation | review | process
```

---
'

FL_33='
## 2026-10-15 — PR #33

- Phase: review
- Observed: an entry nobody touches
'

FL_32='
## 2026-10-15 — PR #32

- Phase: process
- Observed: an entry the branch consumes whole
'

FL_48='
## 2026-10-16 — PR #48

- Phase: process
- Observed: an entry the branch consumes in part. This second sentence is the part it consumes.
'

FL_48_TRIMMED='
## 2026-10-16 — PR #48

- Phase: process
- Observed: an entry the branch consumes in part.
'

FL_58='
## 2026-10-16 — PR #58

- Phase: review
- Observed: the entry main appended
'

FL_60='
## 2026-10-16 — PR #60

- Phase: process
- Observed: the entry this lane logged
'

FL_BASE="$FL_HEAD$FL_33$FL_32$FL_48"

td_fixture() { # td_fixture <name> [<path> <whole file>]… — TD_BASE and any extra logs on main, a lane worktree
  fixture "$1"
  shift
  # The SUBJECT commits here, so an identity has to exist somewhere git will find one.
  # `gitc` passes identity per command and cannot reach a commit this harness does not
  # make, so repo-local config it is — written inside a temp fixture, never on the box.
  must git -C "$REPO" config user.email test@test
  must git -C "$REPO" config user.name test
  must git -C "$REPO" config commit.gpgsign false
  must git init --quiet --bare "$ROOT/origin.git"
  must gitc "$REPO" remote add origin "$ROOT/origin.git"
  must mkdir -p "$REPO/docs"
  must printf '%s' "$TD_BASE" >"$REPO/$TD"
  while [ "$#" -ge 2 ]; do
    must printf '%s' "$2" >"$REPO/$1"
    shift 2
  done
  must gitc "$REPO" add -A
  must gitc "$REPO" commit --quiet -m 'the logs as both sides found them'
  must gitc "$REPO" push --quiet origin main
  must gitc "$REPO" worktree add --quiet -b "$HEAD_REF" "$ROOT/wt" HEAD
}

main_writes() { # main_writes <path> <whole file> [<path> <whole file>]…
  while [ "$#" -ge 2 ]; do
    must printf '%s' "$2" >"$REPO/$1"
    shift 2
  done
  must gitc "$REPO" commit --quiet -am 'another lane merged first'
  must gitc "$REPO" push --quiet origin main
}

td_main_writes() { main_writes "$TD" "$1"; }

# branch_writes — the lane's own copies, pushed, and V_OID moved to the sha GitHub
# would then be answering. That last line is not bookkeeping: the union step refuses to
# resolve a branch whose local tip and headRefOid disagree, so a fixture that left
# V_OID at "aaa111" would test the guard rather than the resolution.
branch_writes() { # branch_writes <path> <whole file> [<path> <whole file>]…
  while [ "$#" -ge 2 ]; do
    must printf '%s' "$2" >"$ROOT/wt/$1"
    shift 2
  done
  must gitc "$ROOT/wt" commit --quiet -am 'the lane logs its own finding'
  must gitc "$ROOT/wt" push --quiet origin "$HEAD_REF"
  V_OID=$(gitc "$ROOT/wt" rev-parse HEAD) || {
    printf 'FATAL could not read the lane tip\n' >&2
    exit 2
  }
}

td_branch_writes() { branch_writes "$TD" "$1"; }

# td_views — the read sequence every union case shares: DIRTY at classify, then one
# post-push read still answering the head the push replaced (the cumulo#501 shape, which
# the union step arms the same gate against), then the new head, CLEAN and green.
td_views() {
  V_MSST="DIRTY"
  write_view 1
  V_MSST="BLOCKED"
  write_view 2
  V_OID="ccc333"
  V_MSST="CLEAN"
  write_view default
  write_merged_view
}

origin_branch_sha() { git -C "$ROOT/origin.git" rev-parse "$HEAD_REF"; }

expect_no_merge_in_progress() {
  ! git -C "$ROOT/wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 ||
    bad "the lane worktree was left mid-merge — a refusal must put the tree back"
}

expect_branch_unpushed() { # expect_branch_unpushed <sha the branch must still be at>
  [ "$(origin_branch_sha)" = "$1" ] ||
    bad "the branch was pushed despite the refusal (origin is at $(origin_branch_sha), expected $1)"
}

origin_branch_file() { git -C "$ROOT/origin.git" show "$HEAD_REF:$1"; }
origin_branch_td() { origin_branch_file "$TD"; }

# conflict_once / conflict_always — update-branch answers a conflict on its first call
# and the no-op after it (the union resolved it), or a conflict on every call.
conflict_once() {
  must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
  must printf '1\n' >"$STATE/update-branch.1.rc"
  must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
}
conflict_always() {
  must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
  must printf '1\n' >"$STATE/update-branch.rc"
}

# expect_union <path> <the whole file the branch must now hold> — the run merged, and
# what it pushed is that file byte for byte, read out of the origin.
expect_union() {
  expect_rc 0
  expect_called "pr merge $PR --squash"
  [ "$(origin_branch_file "$1")" = "$(printf '%s' "$2")" ] ||
    bad "the union pushed for $1 is not the expected file; got:
$(origin_branch_file "$1")"
  expect_no_merge_in_progress
}

# expect_union_refused <branch sha before> <stderr fragment>… — refused before the
# worktree was touched: nothing formatted, pushed or merged, no merge left in progress.
expect_union_refused() {
  local before="$1" fragment
  shift
  expect_rc 1
  expect_stderr 'update-branch — FAILED'
  expect_stderr 'the conflict is not one this script may resolve'
  for fragment in "$@"; do
    expect_stderr "$fragment"
  done
  expect_not_called "pr merge $PR --squash"
  expect_branch_unpushed "$before"
  expect_no_merge_in_progress
  [ ! -f "$STATE/prettier.log" ] || bad "prettier ran on a resolution that was refused"
}

# ==========================================================================================
# 1. the script parses
# ==========================================================================================
begin "merge-pr.sh parses (bash -n)"
expect_parses "$SUBJECT"
end

# ==========================================================================================
# 2. a single-issue PR squashes, and the whole chain reports one line per step
# ==========================================================================================
begin "a single-issue PR merges --squash and every step reports"
fixture single
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
write_view 1
V_OID="bbb222"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'single issue #12 -> squash'
expect_stdout 'AUTO'
expect_stdout 'not owed (no humanAlways path in the diff)'
expect_stdout 'updated onto the base (attempt 1)'
expect_stdout 'the update moved the head aaa111 -> bbb222'
expect_stdout '2 check(s) complete'
expect_stdout 'merged squash (rc=0), state MERGED'
expect_stdout 'closed by the merge: #12'
expect_stdout "none holds '$HEAD_REF'"
expect_stdout "done — PR #$PR MERGED"
expect_called "pr merge $PR --squash"
expect_not_called "pr merge $PR --rebase"
end

# ==========================================================================================
# 3. the label comes off AFTER the merge, never before
# ==========================================================================================
# The defect this is written against is cumulo#469, where the hand-typed chain took
# the label off on CI-green. Asserting the message is not enough — the message
# could be printed in the wrong order and still read correctly — so the assertion
# is on the two calls' positions in the log.
begin "'awaiting-review' is removed only after the PR reports MERGED"
fixture label-order
V_LABELS="awaiting-review"
V_FILES="CLAUDE.md,docs/notes.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,4 @@
+## 2026-09-11 — PR #490 — merge-ritual-script
+
+- **Category**: approved-no-changes
+- **Verdict**: Approved without changes — owner, in chat.
EOF
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'HUMAN (humanAlways: CLAUDE.md)'
expect_stdout 'entry on the branch, both placeholders filled'
expect_stdout "'awaiting-review' removed, after the merge"
expect_called "pr edit $PR --remove-label awaiting-review"
merge_at=$(call_line "pr merge $PR")
edit_at=$(call_line "pr edit $PR")
[ "$merge_at" -gt 0 ] || bad "the PR never merged"
[ "$edit_at" -gt 0 ] || bad "the label was never removed"
[ "$merge_at" -lt "$edit_at" ] ||
  bad "the label came off at call $edit_at, the merge at call $merge_at — the label must come off after"
end

# ==========================================================================================
# 4. a humanAlways PR whose verdict is still a placeholder is REFUSED
# ==========================================================================================
begin "a humanAlways PR with a 'pending — filled at merge' placeholder is refused"
fixture placeholder
V_FILES="docs/adr/0007-thing.md,docs/notes.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,4 @@
+## 2026-09-11 — issue #490 — merge-ritual-script
+
+- **Category**: pending — filled at merge
+- **Verdict**: pending — filled at merge
EOF
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'feedback — FAILED'
expect_stderr 'still reads the literal "pending — filled at merge"'
expect_stdout 'HUMAN (humanAlways: docs/adr/0007-thing.md)'
expect_not_called "pr merge $PR --squash"
expect_not_called "pr update-branch $PR"
[ -f "$STATE/merged" ] && bad "the PR was merged despite the placeholder"
end

# ==========================================================================================
# 5. a humanAlways PR with no review-feedback entry at all is refused
# ==========================================================================================
begin "a humanAlways PR whose branch adds no review-feedback entry is refused"
fixture no-entry
V_FILES="CLAUDE.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/CLAUDE.md b/CLAUDE.md
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -1,0 +2,1 @@
+a new line
EOF
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'feedback — FAILED'
expect_stderr 'adds no lines to docs/review-feedback.md'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 6. an unsupported humanAlways pattern refuses rather than classifying AUTO
# ==========================================================================================
# The one direction a mis-read pattern must never fail in.
begin "a humanAlways pattern the matcher does not understand is refused, not ignored"
fixture bad-pattern '["docs/*.md"]'
write_view default
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'unsupported humanAlways pattern: docs/*.md'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 7. BEHIND: update-branch runs first, and the merge is taken from the refreshed head
# ==========================================================================================
begin "a BEHIND PR is updated first and merges from the new head"
fixture behind
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
V_MSST="BEHIND"
write_view default
write_view 1
# What the refreshed head looks like: a new oid, CLEAN, and its own green checks.
V_MSST="CLEAN"
V_OID="bbb222"
write_view 2
write_merged_view
run_merge
expect_rc 0
expect_called "pr update-branch $PR"
expect_stdout 'updated onto the base (attempt 1)'
expect_stdout '2 check(s) complete on bbb222'
expect_called "pr merge $PR --squash"
update_at=$(call_line "pr update-branch $PR")
merge_at=$(call_line "pr merge $PR")
if [ "$update_at" -le 0 ] || [ "$update_at" -ge "$merge_at" ]; then
  bad "update-branch must run before the merge (update at $update_at, merge at $merge_at)"
fi
end

# ==========================================================================================
# 8. …and a PR that is STILL behind after the update is never merged
# ==========================================================================================
# The companion to case 7, and the one that gives it meaning: update-branch running
# is only half the guarantee. cumulo#484 merged into a BEHIND state; what forbids that
# is the CLEAN check, so a fixture whose head stays BEHIND must refuse.
begin "a PR still BEHIND after update-branch is refused at the merge step"
fixture still-behind
V_MSST="BEHIND"
write_view default
must printf 'already up to date with the base branch\n' >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
write_merged_view
run_merge
expect_rc 1
expect_stdout 'already up to date with the base'
expect_stderr 'merge — FAILED'
expect_stderr "mergeStateStatus is 'BEHIND', not CLEAN"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 9. a batch of Closes lines merges --rebase, and is NEVER update-branch'd
# ==========================================================================================
# `gh pr update-branch` writes a merge commit, which breaks the one-commit-per-member
# invariant and blocks rebase-merge outright (run-issue step 4, and the bounce
# paragraphs in task-orchestrator). Running it and then refusing at the merge step
# would pollute the branch first — so the skip, not a late refusal, is the property.
begin "a multi-Closes PR merges --rebase and is never update-branch'd"
fixture batch
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'batch of 2 issues (#21 #22) -> rebase'
expect_stdout "skipped — a --rebase batch is curated and force-pushed by its owner"
expect_not_called "pr update-branch $PR"
expect_called "pr merge $PR --rebase"
expect_not_called "pr merge $PR --squash"
expect_stdout 'closed by the merge: #21 #22'
end

# ==========================================================================================
# 9b. a `<n>-<slug>` branch whose ticket the Closes list names is ONE issue, however
#     many Closes lines ride with it
# ==========================================================================================
# The plan-issue → execute → review-loop lane writes no declaration into the body;
# its declaration is the branch name. #25 closed its ticket and a discovered issue
# the same diff resolved, and was refused as a two-member batch (#27).
begin "a <n>-slug branch naming a Closes issue squashes despite a second Closes line"
fixture branch-declared
saved_head_ref=$HEAD_REF
HEAD_REF=21-lane
V_BODY="Closes #21. Closes #22."
V_COMMITS="#21: the change,#21: review cycle 1"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout "single issue #21 by head branch '21-lane', also closing #22 -> squash"
expect_not_stdout 'batch of 2 issues'
expect_called "pr merge $PR --squash"
expect_not_called "pr merge $PR --rebase"
expect_stdout 'closed by the merge: #21 #22'
HEAD_REF=$saved_head_ref
end

# ==========================================================================================
# 9c. a branch number no Closes line names declares nothing — the count still decides
# ==========================================================================================
begin "a <n>-slug branch whose number no Closes line names falls through to the count"
fixture branch-undeclared
saved_head_ref=$HEAD_REF
HEAD_REF=99-lane
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'batch of 2 issues (#21 #22) -> rebase'
expect_not_stdout 'by head branch'
expect_called "pr merge $PR --rebase"
HEAD_REF=$saved_head_ref
end

# ==========================================================================================
# 9d. the "also closing" list is built from the array, so a head issue that is a prefix
#     of another Closes number does not eat it
# ==========================================================================================
begin "a head issue that prefixes another Closes number still lists that number"
fixture branch-prefix
saved_head_ref=$HEAD_REF
HEAD_REF=2-lane
V_BODY="Closes #2. Closes #23."
V_COMMITS="#2: the change"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout "single issue #2 by head branch '2-lane', also closing #23 -> squash"
HEAD_REF=$saved_head_ref
end

# ==========================================================================================
# 9e. a header-less batch on an <anchor>-slug branch stays on the rebase arm, because a
#     commit subject names a member other than the anchor
# ==========================================================================================
# A task-orchestrator batch also sits on an `<n>-<slug>` branch with its anchor among
# the Closes; without its TASK REPORT header the branch arm would squash it. The
# curated history is the tell: a member other than the anchor is named in a subject.
begin "a <n>-slug branch whose commits name another Closes issue falls through to the count"
fixture branch-batch-subjects
saved_head_ref=$HEAD_REF
HEAD_REF=21-lane
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'batch of 2 issues (#21 #22) -> rebase'
expect_not_stdout 'by head branch'
expect_called "pr merge $PR --rebase"
expect_not_called "pr merge $PR --squash"
HEAD_REF=$saved_head_ref
end

# ==========================================================================================
# 10. a batch whose history is not curated is refused BEFORE anything is touched
# ==========================================================================================
begin "a batch whose commits do not match its member issues is refused at classify"
fixture batch-uncurated
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the only commit"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'curated history: 1 commit(s) for 2 member issue(s)'
expect_not_called "pr merge $PR --rebase"
expect_not_called "pr update-branch $PR"
end

# ==========================================================================================
# 10b. a batch that is not CLEAN is bounced to its owner, never updated from here
# ==========================================================================================
begin "a BEHIND --rebase batch is refused with the curate-onto-main bounce"
fixture batch-behind
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
V_MSST="BEHIND"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'merge — FAILED'
expect_stderr 'curate onto latest main'
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --rebase"
end

# ==========================================================================================
# 10b-ii. …but the bounce is prescribed only for the states it repairs
# ==========================================================================================
# BLOCKED is branch protection, not a stale branch. Telling a merge owner to bounce
# an agent into a rebase-and-force-push when the blocker is a required review sends
# them to a wrong and expensive repair, so only BEHIND and DIRTY get that message.
begin "a BLOCKED --rebase batch is refused by state, with no curate-onto-main advice"
fixture batch-blocked
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
V_MSST="BLOCKED"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'merge — FAILED'
expect_stderr "mergeStateStatus is 'BLOCKED', not CLEAN"
expect_not_stderr 'curate onto latest main'
expect_not_called "pr merge $PR --rebase"
end

# ==========================================================================================
# 10c. --method overrides the inference, and the squash path updates the branch again
# ==========================================================================================
# The inference is a heuristic: cumulo#414 carried four Closes lines and was squashed.
# An operator who knows the lane says so, and the update-branch skip — which is a
# property of the REBASE path, not of the Closes count — goes with the method.
begin "--method squash overrides a multi-Closes inference, update-branch included"
fixture method-override
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
capture -C "$REPO" env \
  MERGE_PR_GH_CMD="$ROOT/gh" MERGE_PR_REAP_CMD="$ROOT/reap" \
  MERGE_PR_POLL_INTERVAL_SECONDS=0 MERGE_PR_POLL_TIMEOUT_SECONDS=30 \
  MERGE_PR_RETRY_SECONDS=0 MERGE_PR_CONFIRM_RETRIES=2 \
  bash "$SUBJECT" --method squash "$PR" "$REPO"
expect_rc 0
expect_stdout 'overridden to squash'
expect_called "pr update-branch $PR"
expect_called "pr merge $PR --squash"
expect_not_called "pr merge $PR --rebase"
end

# ==========================================================================================
# 10d. a PR with no Closes line is refused at classify, before anything is touched
# ==========================================================================================
# Not a corner: retro PRs and campaign batches here routinely carry none, so this is
# the path a merge owner meets in practice. Refusing it at the merge step would mean
# refusing after update-branch had written to the branch and a CI round had been spent.
begin "a PR with no Closes line is refused at classify"
fixture no-closes
V_BODY="What and why, with no closing keyword at all."
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'no Closes line in the PR body'
expect_stderr 'pass --method squash|rebase'
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 10e. a ticket-agent lane squashes however many issues it closes
# ==========================================================================================
# cumulo#611 was one lane that also closed the issue it resolved: two Closes lines, six
# commits, and the Closes count called it a batch and refused it on curated history.
# The lane report header is the lane declaring itself, so it outranks the count.
# Fenced (cumulo#611 used backticks; tildes here keep shellcheck quiet), so the header is read
# wherever a line starts with it.
begin "a lane report with two Closes lines merges --squash, not as a batch"
fixture lane-two-closes
V_BODY='Closes #21. Closes #22.\n\n~~~\n## Lane report — issue #21\nSTATUS: DONE\n~~~'
V_COMMITS="#21: the first,#21: the second,#21: the third"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'ticket-agent lane for #21 -> squash'
expect_not_stdout 'batch of 2 issues'
expect_called "pr update-branch $PR"
expect_called "pr merge $PR --squash"
expect_not_called "pr merge $PR --rebase"
expect_stdout 'closed by the merge: #21 #22'
end

# ==========================================================================================
# 10e-ii. a lane report whose issue no Closes line names is refused at classify
# ==========================================================================================
# The lane closes its own issue (ticket-agent rule 7). Without this, a lane body with
# no Closes line would skip 10d's refusal and merge with the issue left open.
begin "a lane report with no Closes line for its issue is refused at classify"
fixture lane-unclosed
V_BODY='What and why.\n## Lane report — issue #21'
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'the lane report names #21 but no Closes line does'
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --squash"
end

begin "a lane report whose issue is missing from its Closes lines is refused at classify"
fixture lane-other-closes
V_BODY='Closes #22.\n## Lane report — issue #21'
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'the lane report names #21 but no Closes line does'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 10e-iii. a task-orchestrator batch merges --rebase by its TASK REPORT header
# ==========================================================================================
# task-orchestrator rule 7 puts the header line in the body. With it, a batch whose
# other members dropped still rebases on one Closes line, where the count says squash.
begin "a batch TASK REPORT header merges --rebase"
fixture batch-header
V_BODY='Closes #21\nCloses #22\n## TASK REPORT — batch: anchor #21, members #21 #22'
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'task-orchestrator batch, anchor #21 -> rebase'
expect_not_called "pr update-branch $PR"
expect_called "pr merge $PR --rebase"
expect_not_called "pr merge $PR --squash"
end

begin "a batch TASK REPORT header with one surviving member still merges --rebase"
fixture batch-header-one
V_BODY='Closes #21\n## TASK REPORT — batch: anchor #21, members #21'
V_COMMITS="#21: the only member left"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'task-orchestrator batch, anchor #21 -> rebase'
expect_not_stdout 'single issue #21 -> squash'
expect_called "pr merge $PR --rebase"
expect_not_called "pr merge $PR --squash"
end

begin "a lane report beside a batch TASK REPORT header is refused at classify"
fixture lane-and-batch
V_BODY='Closes #21\nCloses #22\n## Lane report — issue #21\n## TASK REPORT — batch: anchor #21, members #21 #22'
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr '2 lane declarations'
expect_not_called "pr merge $PR --rebase"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 10f. two lane reports in one body are refused at classify
# ==========================================================================================
# A lane PR has one owner; a body naming two is a pasting slip, and squashing a
# body that may be a batch is the irreversible direction.
begin "a body with two lane reports is refused at classify"
fixture lane-two-reports
V_BODY='Closes #21. Closes #22.\n## Lane report — issue #21\n## Lane report — issue #22'
V_COMMITS="#21: the first,#22: the second"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr '2 lane declarations'
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --squash"
expect_not_called "pr merge $PR --rebase"
end

# ==========================================================================================
# 11. a failing check exits non-zero and names the check
# ==========================================================================================
begin "a failing check exits non-zero, naming it, and never merges"
fixture red-check
V_CHECKS="checks:COMPLETED:SUCCESS,web-e2e:COMPLETED:FAILURE"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'checks — FAILED'
expect_stderr "check 'web-e2e' concluded FAILURE"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 12. an empty rollup is not green — "no check is pending" is trivially true of nothing
# ==========================================================================================
# The hole a settle-sleep papers over: immediately after update-branch the new head
# has no checks registered yet. The pre-update count is the floor the new head must
# reach, so an empty rollup polls on and, with no budget left, times out saying so.
begin "a rollup that has not registered yet is never read as green"
fixture unregistered
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
write_view default
write_view 1
# The new head, with nothing registered on it yet.
V_OID="bbb222"
V_CHECKS=""
write_view 2
POLL_TIMEOUT=0
run_merge
POLL_TIMEOUT=30
expect_rc 1
expect_stderr 'checks — FAILED'
expect_stderr 'timed out'
expect_stderr '0 of an expected 2 check(s) present'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 12b. the post-update rollup that is still the OLD head's is waited out, in one run
# ==========================================================================================
# cumulo#501's sequence exactly: update-branch wrote, and the next read answered the
# old head's sha, the old head's rollup — complete, none pending, so the baseline
# floor was satisfied by it — and BLOCKED. The floor cannot separate that answer
# from a fresh one; the sha can. The property is that ONE invocation waits and then
# merges, because the manual repair for this was a second run 90 s later.
begin "a post-update rollup still belonging to the old head is waited out, then merged"
fixture stale-rollup
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
V_MSST="BEHIND"
write_view 1
V_MSST="BLOCKED"
write_view 2
V_OID="bbb222"
V_MSST="CLEAN"
write_view 3
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'updated onto the base (attempt 1)'
expect_stdout 'the update moved the head aaa111 -> bbb222'
expect_stdout '2 check(s) complete on bbb222'
expect_not_stdout 'complete on aaa111'
# Every poll read is logged, the stale one included: that is the record the stuck
# runs of issue #55 did not leave.
expect_stderr 'head=aaa111 await_new_head=1 merge_state=BLOCKED'
expect_stderr 'head=bbb222 await_new_head=0 merge_state=CLEAN verdict=ready:2'
expect_not_stderr "mergeStateStatus is 'BLOCKED'"
expect_called "pr merge $PR --squash"
# The stale answer was re-read rather than believed: classify, the stale poll, the
# fresh poll and the post-merge confirmation are four reads. A subject that took
# the first post-update answer never reaches the fourth — it breaks the poll on the
# stale rollup and refuses at the merge step on the BLOCKED beside it, which is
# cumulo#501's outcome.
views=$(grep -c -- "^pr view $PR " "$STATE/calls.log")
[ "$views" -ge 4 ] || bad "expected at least 4 pr view calls, got $views"
end

# ==========================================================================================
# 12c. …and an update that reports a write while the head never moves is refused
# ==========================================================================================
# The companion that gives 12b its meaning: waiting is only half the guarantee, and
# a wait with no end is how the timeout budget gets spent on a PR nobody is going
# to merge. The fixture is otherwise mergeable — CLEAN, two green checks — so a
# subject that skipped the sha would merge it.
#
# One fixture, two causes: the update has not landed, or gh answered a no-op in a
# spelling the update-branch step does not recognise. They are indistinguishable
# from here, which is why the refusal quotes gh's answer rather than naming one.
begin "an update that reports a write while the head never moves is refused"
fixture head-unmoved
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
write_view default
write_merged_view
POLL_TIMEOUT=0
run_merge
POLL_TIMEOUT=30
expect_rc 1
expect_stderr 'checks — FAILED'
expect_stderr 'the head still reads aaa111'
expect_stderr "gh answered \"$UPDATE_WROTE\""
expect_stderr 'no-op spelling update-branch does not recognise'
expect_not_called "pr merge $PR --squash"
[ -f "$STATE/merged" ] && bad "the PR merged on a head that never moved"
end

# ==========================================================================================
# 12d. a rollup carrying two runs of each check reads the latest run, not the array order
# ==========================================================================================
# A label event re-runs the whole workflow on the same head, so the rollup holds two
# entries per job (PR #53 at 696a6e9). The superseded runs here are still IN_PROGRESS
# and are listed AFTER the fresh green ones, the order PR #51's rollup came back in,
# so a subject reading the last entry per name would also fail this case.
T_OLD='2026-10-16T10:45:07Z'
T_NEW='2026-10-16T10:47:25Z'
begin "a superseded run still in progress does not hold up the check that re-ran green"
fixture rerun-latest-wins
V_CHECKS="checks:COMPLETED:SUCCESS@$T_NEW,gitleaks:COMPLETED:SUCCESS@$T_NEW,checks:IN_PROGRESS:@$T_OLD,gitleaks:IN_PROGRESS:@$T_OLD"
write_view default
write_merged_view
POLL_TIMEOUT=0
run_merge
POLL_TIMEOUT=30
expect_rc 0
expect_stdout '2 check(s) complete on aaa111'
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 12e. the floor is counted in distinct checks, so a labelled head cannot inflate it
# ==========================================================================================
# The pre-update head carries six entries (three checks, run twice); the head
# update-branch writes carries three. Counted raw, the floor would be six and the
# fresh head could never reach it.
begin "a six-entry labelled head sets a floor of three for the fresh head"
fixture rerun-floor
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
V_MSST="BEHIND"
V_CHECKS="checks:COMPLETED:SUCCESS@$T_OLD,gitleaks:COMPLETED:SUCCESS@$T_OLD,merge-ritual-gate:COMPLETED:SUCCESS@$T_OLD,checks:COMPLETED:SUCCESS@$T_NEW,gitleaks:COMPLETED:SUCCESS@$T_NEW,merge-ritual-gate:COMPLETED:SUCCESS@$T_NEW"
write_view 1
V_OID="bbb222"
V_MSST="CLEAN"
V_CHECKS="checks:COMPLETED:SUCCESS@$T_NEW,gitleaks:COMPLETED:SUCCESS@$T_NEW,merge-ritual-gate:COMPLETED:SUCCESS@$T_NEW"
write_view default
write_merged_view
POLL_TIMEOUT=0
run_merge
POLL_TIMEOUT=30
expect_rc 0
expect_stdout '3 check(s) complete on bbb222'
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 12f. …and the latest run decides in the failing direction too
# ==========================================================================================
# PR #51's post-merge rollup: a fresh gitleaks run FAILED where the earlier one passed.
# Latest-wins has to mean that the failure is what this step sees.
begin "a re-run that failed overrides the earlier green run of the same check"
fixture rerun-failed
V_CHECKS="checks:COMPLETED:SUCCESS@$T_OLD,gitleaks:COMPLETED:FAILURE@$T_NEW,gitleaks:COMPLETED:SUCCESS@$T_OLD"
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr "check 'gitleaks' concluded FAILURE"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 12g. two runs started in the same second are never settled toward green
# ==========================================================================================
# Run in both orders, so neither "first wins" nor "last wins" can pass it. The case
# also pins the poll's log line: the read names what it is waiting on.
begin "a startedAt tie between a pending and a green run stays pending"
tie=0
for order in "checks:IN_PROGRESS:@$T_NEW,checks:COMPLETED:SUCCESS@$T_NEW" \
  "checks:COMPLETED:SUCCESS@$T_NEW,checks:IN_PROGRESS:@$T_NEW"; do
  case_ctx="order $order"
  tie=$((tie + 1))
  fixture "rerun-tie-$tie"
  V_CHECKS="$order"
  write_view default
  write_merged_view
  POLL_TIMEOUT=0
  run_merge
  POLL_TIMEOUT=30
  expect_rc 1
  expect_stderr 'timed out'
  expect_stderr '1 still pending'
  expect_stderr 'head=aaa111 await_new_head=0 merge_state=CLEAN'
  expect_stderr 'waiting_on=[checks=IN_PROGRESS]'
  expect_not_called "pr merge $PR --squash"
done
case_ctx=""
end

# ==========================================================================================
# 12g-ii. a re-run with no start time yet is newer than any run that has one
# ==========================================================================================
# A queued run has not started: gh answers its startedAt empty, or as the zero time
# 0001-01-01T00:00:00Z (seen live on PR #59's completedAt). A string comparison
# ranks both below every real timestamp, which would keep the older green run.
begin "a queued re-run with no start time holds the check pending over an older green run"
for unset in "" "@0001-01-01T00:00:00Z"; do
  case_ctx="startedAt '${unset#@}'"
  fixture "rerun-queued${unset:+-zero}"
  V_CHECKS="checks:COMPLETED:SUCCESS@$T_OLD,checks:QUEUED:$unset"
  write_view default
  write_merged_view
  POLL_TIMEOUT=0
  run_merge
  POLL_TIMEOUT=30
  expect_rc 1
  expect_stderr '1 still pending'
  expect_stderr 'waiting_on=[checks=QUEUED]'
  expect_not_called "pr merge $PR --squash"
done
case_ctx=""
end

# ==========================================================================================
# 12h. a job name shared by two workflows is two checks, not two runs of one
# ==========================================================================================
begin "a check name two workflows share is counted once per workflow"
fixture two-workflows
V_CHECKS="checks:COMPLETED:SUCCESS@$T_NEW@CI,checks:IN_PROGRESS:@$T_OLD@Nightly"
write_view default
write_merged_view
POLL_TIMEOUT=0
run_merge
POLL_TIMEOUT=30
expect_rc 1
expect_stderr '2 of an expected 2 check(s) present, 1 still pending'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 13. a run that dies mid-poll leaves nothing behind, and a re-run finishes the chain
# ==========================================================================================
# cumulo#488: the chain died on `error connecting to api.github.com` and left the PR
# open with no signal. The property under test is that the repair is a re-run —
# the script keeps no state of its own, so the second run re-reads and proceeds.
# The poll retries a failed read MERGE_PR_READ_RETRIES times (2 here), so the
# outage outlasts that: reads 2, 3 and 4 all fail.
begin "a re-run after a mid-poll network failure resumes and completes"
fixture resume
write_view default
for n in 2 3 4; do
  must printf 'error connecting to api.github.com\n' >"$STATE/view.$n"
  must printf '1\n' >"$STATE/view.$n.rc"
done
write_merged_view
run_merge
expect_rc 1
expect_stderr 'checks — FAILED'
expect_stderr '3 consecutive reads failed'
expect_stderr 'api.github.com'
expect_not_called "pr merge $PR --squash"
[ -f "$STATE/merged" ] && bad "the failed run merged anyway"

for n in 2 3 4; do must rm -f "$STATE/view.$n" "$STATE/view.$n.rc"; done
reset_calls
run_merge
expect_rc 0
expect_called "pr update-branch $PR"
expect_called "pr merge $PR --squash"
expect_stdout "done — PR #$PR MERGED"
end

# ==========================================================================================
# 13b. a poll read that hangs is killed at the time box, retried, then fails the step
# ==========================================================================================
# Issue #55: every read carries a time box. The stub holds each read for 30 s and
# the box fires at each hang (sleep_stub), so a subject without the box takes 90 s
# and then fails the elapsed-time assertion below as well as the message ones.
begin "a poll read that outlives the time box is retried, then fails the checks step"
fixture read-hangs
write_view default
for n in 2 3 4; do must printf '30\n' >"$STATE/view.$n.hang"; done
write_merged_view
FAKE_BOX=1
started=$SECONDS
run_merge
elapsed=$((SECONDS - started))
FAKE_BOX=""
expect_rc 1
expect_stderr 'checks — FAILED'
expect_stderr 'read failed (2 in a row, 2 retries allowed)'
expect_stderr '3 consecutive reads failed'
expect_stderr "did not answer within ${GH_TIMEOUT}s"
expect_not_called "pr merge $PR --squash"
views=$(grep -c -- "^pr view $PR " "$STATE/calls.log")
[ "$views" -eq 4 ] || bad "expected classify plus a read and its two retries, got $views pr view calls"
[ "$elapsed" -lt 45 ] || bad "the run took ${elapsed}s, so the box did not cut the 90 s of hangs short"
end

# ==========================================================================================
# 13c. …and one hung read followed by an answer costs nothing but the retry
# ==========================================================================================
begin "a single hung poll read is retried and the run merges"
fixture read-hangs-once
write_view default
must printf '30\n' >"$STATE/view.2.hang"
# Classify answers after 2 s, past the 1 s box these cases ran at before issue #152.
must printf '2\n' >"$STATE/view.1.delay"
write_merged_view
FAKE_BOX=1
run_merge
FAKE_BOX=""
expect_rc 0
expect_stderr 'read failed (1 in a row, 2 retries allowed)'
expect_called "pr merge $PR --squash"
expect_stdout "done — PR #$PR MERGED"
end

# ==========================================================================================
# 13d. a hung update-branch fails its step rather than retrying a write of unknown outcome
# ==========================================================================================
# A retry would be wrong here, not just slow. If the killed call had written, the
# retry answers "already up to date", and the await gate stays disarmed while GitHub
# still answers the replaced head, which is cumulo#501's defect.
begin "an update-branch that outlives the time box fails its step and is not retried"
fixture update-hangs
write_view default
must printf '30\n' >"$STATE/update-branch.1.hang"
write_merged_view
FAKE_BOX=1
run_merge
FAKE_BOX=""
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'whether it wrote is unknown'
expect_stderr "did not answer within ${GH_TIMEOUT}s"
ubs=$(grep -c -- "^pr update-branch $PR" "$STATE/calls.log")
[ "$ubs" -eq 1 ] || bad "a write of unknown outcome was retried: $ubs update-branch calls"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 14. an already-merged PR runs only what is still owed
# ==========================================================================================
begin "an already-MERGED PR skips the merge steps and finishes the post-merge ones"
fixture idempotent
V_STATE="MERGED"
V_MSST="UNKNOWN"
V_LABELS="awaiting-review"
write_view default
run_merge
expect_rc 0
expect_stdout 'skipped (PR is already MERGED)'
expect_stdout "'awaiting-review' removed, after the merge"
expect_stdout "done — PR #$PR MERGED"
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --squash"
expect_called "pr edit $PR --remove-label awaiting-review"
end

# ==========================================================================================
# 15. a Closes issue the merge did not close is reported, and the run ends non-zero
# ==========================================================================================
begin "an issue still OPEN after the merge is reported and the run ends non-zero"
fixture open-issue
write_view default
write_merged_view
must printf '{"number":12,"state":"OPEN"}\n' >"$STATE/issue.12"
run_merge
expect_rc 1
expect_stdout 'still OPEN: #12'
expect_stderr 'is merged, but the chain did not finish clean'
expect_stderr 'did not close #12'
# The merge itself still happened, and the steps after the issue check still ran:
# once the PR is merged there is nothing left to stop, only to report.
expect_called "pr merge $PR --squash"
expect_stdout "none holds '$HEAD_REF'"
end

# ==========================================================================================
# 16. the worktree holding the branch is handed to reap-worktree.sh
# ==========================================================================================
begin "a worktree holding the head branch is delegated to reap-worktree.sh"
fixture reap
must gitc "$REPO" worktree add --quiet -b "$HEAD_REF" "$ROOT/wt" HEAD
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'REAPED'
[ -f "$STATE/reap.log" ] || bad "reap-worktree.sh was never called"
grep -qF -- "$ROOT/wt" "$STATE/reap.log" ||
  bad "reap was not pointed at the worktree holding the branch: $(cat "$STATE/reap.log" 2>/dev/null)"
end

# ==========================================================================================
# 17. …but never the worktree the caller is standing in
# ==========================================================================================
# reap-worktree.sh has its own own-cwd guard and this does not replace it; what is
# asserted here is that merge-pr.sh never even dispatches, so the guarantee does
# not depend on a second script's internals staying as they are.
begin "the worktree the caller is running in is never reaped"
fixture reap-own-cwd
must gitc "$REPO" worktree add --quiet -b "$HEAD_REF" "$ROOT/wt" HEAD
write_view default
write_merged_view
run_merge "$ROOT/wt"
expect_rc 0
expect_stdout "is the caller's own working directory — not reaped"
[ -f "$STATE/reap.log" ] && bad "reap was dispatched against the caller's own cwd"
end

# ==========================================================================================
# 17b. the humanAlways decision is made off the PAGINATED file list
# ==========================================================================================
# `gh pr view --json files` is files(first: 100) with no truncation signal, so a PR
# whose only humanAlways path sorts past the cap would classify AUTO and merge with
# no owner review — the one direction that cannot be taken back. The fixture proves
# the subject reads the api list and not the view: only the api list carries
# CLAUDE.md, and the run must still come out HUMAN.
begin "humanAlways is classified from the paginated file list, not the capped one"
fixture paginated-files
V_FILES="docs/notes.md"
write_view default
write_merged_view
must printf 'docs/notes.md\nCLAUDE.md\n' >"$STATE/files"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,3 @@
+## 2026-09-11 — PR #490 — slug
+- **Category**: approved-no-changes
+- **Verdict**: Approved without changes.
EOF
run_merge
expect_rc 0
expect_stdout 'HUMAN (humanAlways: CLAUDE.md)'
expect_called "api repos/{owner}/{repo}/pulls/$PR/files --paginate --jq .[].filename"
end

# ==========================================================================================
# 17c. an empty file list refuses rather than classifying AUTO against nothing
# ==========================================================================================
begin "an empty changed-file list is refused, not read as AUTO"
fixture empty-files
write_view default
must : >"$STATE/files"
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'came back empty'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 17d. the placeholder is looked for in the two declared FIELDS, not in any added line
# ==========================================================================================
# docs/review-feedback.md's own `## Entry format` section quotes the literal
# while explaining it. A humanAlways PR editing that section must not be refused
# with a message about a verdict it does not have: a refusal whose stated reason is
# false teaches the reader to stop believing the next one.
begin "the placeholder quoted in the Entry-format prose is not read as an unfilled verdict"
fixture placeholder-in-prose
V_FILES="CLAUDE.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,6 @@
+A pre-label entry writes both Category and Verdict as the literal
+`pending — filled at merge`, and whoever merges fills them on the branch.
+
+## 2026-09-11 — PR #490 — slug
+- **Category**: convention
+- **Verdict**: Approved without changes.
EOF
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout 'entry on the branch, both placeholders filled'
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 17e. an entry missing its Verdict line is refused
# ==========================================================================================
begin "an added entry with no Verdict line is refused"
fixture no-verdict
V_FILES="CLAUDE.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,2 @@
+## 2026-09-11 — PR #490 — slug
+- **Category**: convention
EOF
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'feedback — FAILED'
expect_stderr 'no "- **Verdict**:" line'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 17f. an already-merged humanAlways PR with an unfilled verdict is reported, not refused
# ==========================================================================================
# Once the PR is merged there is nothing left to stop — but "a merged entry still
# reading pending is a verdict nobody filled", so the run still ends non-zero and
# the remaining post-merge steps still run.
begin "an unfilled verdict on an already-merged PR is deferred, not refused"
fixture merged-unfilled
V_STATE="MERGED"
V_MSST="UNKNOWN"
V_FILES="CLAUDE.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,3 @@
+## 2026-09-11 — PR #490 — slug
+- **Category**: pending — filled at merge
+- **Verdict**: pending — filled at merge
EOF
write_view default
run_merge
expect_rc 1
expect_stdout 'UNFILLED on an already-merged PR'
expect_stderr 'is merged, but the chain did not finish clean'
expect_stdout 'closed by the merge: #12'
expect_stdout "none holds '$HEAD_REF'"
end

# ==========================================================================================
# 17g. a CLOSED-but-unmerged PR has no ritual to run
# ==========================================================================================
begin "a CLOSED PR that was never merged is refused outright"
fixture closed
V_STATE="CLOSED"
write_view default
run_merge
expect_rc 1
expect_stderr 'classify — FAILED'
expect_stderr 'CLOSED without being merged'
expect_not_called "pr merge $PR --squash"
expect_not_called "pr update-branch $PR"
end

# ==========================================================================================
# 17h. a PR merged elsewhere while this run was working finishes the chain, it does not fail
# ==========================================================================================
# A merged PR reports mergeStateStatus UNKNOWN, the same answer GitHub gives while
# it is still computing a merge, so the merge step cannot read that status alone.
# What this case pins is the STATE guard the merge block opens with: without it the
# run would refuse a PR that is merged. It does NOT pin the MERGED arm of the
# re-read loop above — that arm only saves the remaining sleeps, and deleting it
# leaves this case green, which is the honest thing to say about a case rather than
# claim coverage the mutation does not support.
begin "a PR merged elsewhere mid-run finishes the post-merge steps instead of failing"
fixture merged-elsewhere
V_LABELS="awaiting-review"
write_view default
write_view 1
# The poll's read: checks are ready, but the merge state has not settled, which is
# what sends the merge step into its UNKNOWN re-read loop.
V_MSST="UNKNOWN"
write_view 2
# What that loop reads: merged, and still answering UNKNOWN — which is what a
# merged PR always answers, and the reason the loop cannot watch the status alone.
V_STATE="MERGED"
write_view 3
run_merge
expect_rc 0
expect_stdout 'skipped (the PR was merged elsewhere while this run was working)'
expect_stdout "'awaiting-review' removed, after the merge"
expect_stdout "done — PR #$PR MERGED"
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 17i. gh's no-op answer is read on the SUCCESS path, where it actually arrives
# ==========================================================================================
# gh prints "PR branch already up-to-date" and exits 0. A step that reported every
# rc=0 as "updated onto the base" would claim a write that never happened — and the
# checks baseline it implies is the difference between waiting for a new head's
# workflows and merging on the old head's results.
begin "an rc=0 'already up-to-date' answer is reported as a no-op, not as an update"
fixture noop-success
write_view default
must printf 'PR branch already up-to-date\n' >"$STATE/update-branch.out"
must printf '0\n' >"$STATE/update-branch.rc"
write_merged_view
run_merge
expect_rc 0
expect_stdout 'already up to date with the base'
expect_not_stdout 'updated onto the base'
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 17j. the head-sha race is retried, in the spelling GitHub actually uses
# ==========================================================================================
# The REST 422 reads `expected_head_sha didn't match pull request head.` —
# underscores. An arm matching only "head sha" with a space never sees it, and the
# run fails on the exact race the retry loop exists for.
begin "an expected_head_sha 422 is retried rather than failing the run"
fixture headsha-race
write_view default
must printf "expected_head_sha didn't match pull request head.\n" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
write_merged_view
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'the head moved under every one of 3 attempts'
expect_not_called "pr merge $PR --squash"
# Retried, not refused on the first answer: three attempts, one call each.
attempts=$(grep -c -- "^pr update-branch $PR\$" "$STATE/calls.log")
[ "$attempts" = "3" ] || bad "expected 3 update-branch attempts, got $attempts"
end

# ==========================================================================================
# 17k. an entry with no Category line is refused
# ==========================================================================================
begin "an added entry with no Category line is refused"
fixture no-category
V_FILES="CLAUDE.md"
cat >"$STATE/diff" <<'EOF'
diff --git a/docs/review-feedback.md b/docs/review-feedback.md
--- a/docs/review-feedback.md
+++ b/docs/review-feedback.md
@@ -1,0 +2,2 @@
+## 2026-09-11 — PR #490 — slug
+- **Verdict**: Approved without changes.
EOF
write_view default
write_merged_view
run_merge
expect_rc 1
expect_stderr 'feedback — FAILED'
expect_stderr 'no "- **Category**:" line'
expect_not_called "pr merge $PR --squash"
end

# ==========================================================================================
# 20. append vs append: resolved, pushed and MERGED in one invocation
# ==========================================================================================
# The whole point of cumulo#513. Four PRs on 2026-09-11 arrived DIRTY for this exact reason
# and were resolved by hand four times, so "one invocation" is the property — not "the
# script offers to help and the merge owner finishes it".
begin "two lanes that both appended a tech-debt entry are unioned, pushed and merged in one run"
td_fixture union-append
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
td_views
run_merge
expect_rc 0
expect_stdout 'gh reports a conflict; asking whether it is an append-only-log collision'
expect_stdout "$TD unioned and pushed"
expect_stdout 'base appended 1 entr(ies), the branch 1'
expect_stdout 'the update moved the head'
expect_called "pr merge $PR --squash"
expect_stdout "done — PR #$PR MERGED"
# What actually landed on the branch, read out of the origin rather than off stdout.
[ "$(origin_branch_sha)" != "$before_sha" ] || bad "the resolution was never pushed"
resolved=$(origin_branch_td)
case "$resolved" in
  *'the entry that was already here'*) ;;
  *) bad "the union dropped the entry both sides inherited" ;;
esac
main_at=$(printf '%s\n' "$resolved" | grep -n 'another lane merged first' | cut -d: -f1)
branch_at=$(printf '%s\n' "$resolved" | grep -n 'this lane logged' | cut -d: -f1)
[ -n "$main_at" ] || bad "the union dropped main's appended entry"
[ -n "$branch_at" ] || bad "the union dropped the branch's appended entry"
[ "${main_at:-0}" -lt "${branch_at:-0}" ] ||
  bad "main's entry must come first and the branch's after (main at $main_at, branch at $branch_at)"
# Formatted before it was committed, over the file it resolved.
grep -qxF -- "--write $TD" "$STATE/prettier.log" ||
  bad "prettier was not run over $TD (log: $(cat "$STATE/prettier.log" 2>/dev/null))"
# And the tree it worked in was left as it found it: clean, no merge in progress.
expect_no_merge_in_progress
st=$(git -C "$ROOT/wt" status --porcelain)
[ -z "$st" ] || bad "the lane worktree was left dirty after a successful resolution: $st"
end

# ==========================================================================================
# 20b. one side's edit to an entry the base already had is kept beside both appends
# ==========================================================================================
# An entry is merged three ways, so an edit only one side made is that side's to keep
# (#60: PR #61's rebase trimmed the base's final entry beside main's append).
begin "an edit one side made to the base's final entry survives the union"
td_fixture union-edit
td_edited="${TD_BASE%- Source: #1
}- Source: #1, and also #9
"
td_main_writes "$td_edited$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
conflict_once
td_views
run_merge
expect_union "$TD" "$td_edited$TD_MAIN_ENTRY$TD_BRANCH_ENTRY"
expect_stdout 'base appended 1 entr(ies), the branch 1; 1 edited in place; 3 entr(ies) in all'
end

# ==========================================================================================
# 20b-ii. …but an entry both sides edited incompatibly is refused, naming it
# ==========================================================================================
begin "an entry both sides edited to different text is refused rather than unioned"
td_fixture union-edit-both
td_main_writes "${TD_BASE%- Source: #1
}- Source: #1, and also #9
$TD_MAIN_ENTRY"
td_branch_writes "${TD_BASE%- Source: #1
}- Source: #1, and also #7
$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$TD: the entry \"## 2026-09-01 — the entry that was already here\" was changed on both sides" \
  'does not merge: git merge-file leaves 1 conflict(s) there'
[ -f "$STATE/merged" ] && bad "the PR merged despite the refusal"
end

# ==========================================================================================
# 20c. a second conflicted file is refused, and the set is named
# ==========================================================================================
begin "a conflicted set reaching past the append-only logs is refused, naming every member"
td_fixture union-two-files
must printf 'as the base had it\n' >"$REPO/notes.txt"
must gitc "$REPO" add -A
must gitc "$REPO" commit --quiet -m 'a second file both sides will touch'
must gitc "$REPO" push --quiet origin main
must gitc "$REPO" worktree remove --force "$ROOT/wt"
must gitc "$REPO" branch -D "$HEAD_REF" >/dev/null
must gitc "$REPO" worktree add --quiet -b "$HEAD_REF" "$ROOT/wt" HEAD
must printf 'as main has it\n' >"$REPO/notes.txt"
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
must printf 'as the branch has it\n' >"$ROOT/wt/notes.txt"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'the conflicted set is'
expect_stderr 'notes.txt'
expect_stderr 'this step resolves only the append-only logs'
expect_stderr 'and notes.txt is not one'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
end

# ==========================================================================================
# 20d. a dirty lane worktree is refused before anything is touched
# ==========================================================================================
# Somebody's uncommitted work is in there. A merge would either refuse halfway or sweep
# it into the resolution commit, and this script is not entitled to either outcome.
begin "a lane worktree with uncommitted work in it is refused, and nothing is merged"
td_fixture union-dirty
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf 'half a thought\n' >"$ROOT/wt/scratch.txt"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'is not clean'
expect_stderr 'scratch.txt'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
[ -f "$ROOT/wt/scratch.txt" ] || bad "the refusal removed the uncommitted work it refused over"
end

# ==========================================================================================
# 20e. no worktree holds the branch — there is nowhere to do this
# ==========================================================================================
begin "a branch no worktree holds is refused rather than checked out somewhere"
td_fixture union-no-worktree
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must gitc "$REPO" worktree remove --force "$ROOT/wt"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "no worktree holds '$HEAD_REF'"
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
end

# ==========================================================================================
# 20f. an append with no heading of its own stays inside the entry it extends
# ==========================================================================================
# Text appended under the last entry is an edit to THAT entry, so it is kept with it and
# the other side's new entry follows — never spliced between its heading and its body.
begin "a tail append carrying no heading of its own stays in the entry it extends"
td_fixture union-no-heading
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "${TD_BASE}- Update: and one more thing about that same entry
"
conflict_once
td_views
run_merge
expect_union "$TD" "${TD_BASE}- Update: and one more thing about that same entry
$TD_MAIN_ENTRY"
expect_stdout 'base appended 1 entr(ies), the branch 0; 1 edited in place'
end

# ==========================================================================================
# 20f-ii. …and two such appends to the same entry are refused
# ==========================================================================================
begin "both sides extending the same entry without a heading is refused"
td_fixture union-no-heading-both
td_main_writes "${TD_BASE}- Update: what main adds to that entry
"
td_branch_writes "${TD_BASE}- Update: what the branch adds to that entry
"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  'the entry that was already here" was changed on both sides and does not merge'
end

# ==========================================================================================
# 20g. a second conflict after a resolution fails the run rather than looping
# ==========================================================================================
# The resolution reported success and gh still says conflict: either main moved again —
# which a re-run handles — or what was resolved was never what update-branch meant. Both
# want a human reading the message, and neither wants the attempt budget spent on a loop.
begin "a conflict reported again after the union fails the run instead of retrying it"
td_fixture union-twice
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stdout "$TD unioned and pushed"
expect_stderr 'update-branch — FAILED'
expect_stderr 'reports a conflict again after the'
expect_not_called "pr merge $PR --squash"
# Two attempts, not three: the second conflict ends the run rather than consuming the
# rest of MERGE_PR_UPDATE_RETRIES.
attempts=$(grep -c -- "^pr update-branch $PR\$" "$STATE/calls.log")
[ "$attempts" = "2" ] || bad "expected 2 update-branch attempts, got $attempts"
end

# ==========================================================================================
# 20h. a conflict spelling the arm does not match still fails the run
# ==========================================================================================
# The safe direction, unchanged from before the step existed: an answer this script
# cannot classify fails, and the union step is never even asked.
begin "an update-branch failure that does not read as a conflict never reaches the union step"
td_fixture union-unmatched
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf 'HTTP 503: the server is having a moment\n' >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'gh pr update-branch exited 1'
expect_not_stdout 'asking whether it is'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
end

# ==========================================================================================
# 20i. a --rebase batch never reaches the union step at all
# ==========================================================================================
# The step lives inside update-branch, which a batch skips: `gh pr update-branch` writes
# a merge commit and blocks rebase-merge outright, and so would this resolution.
begin "a --rebase batch is never offered the union, because it is never update-branch'd"
td_fixture union-batch
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
V_BODY="Closes #21 and Closes #22"
V_COMMITS="#21: the first,#22: the second"
V_MSST="DIRTY"
write_view default
write_merged_view
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
run_merge
expect_rc 1
expect_stderr 'merge — FAILED'
expect_stderr 'curate onto latest main'
expect_not_stdout 'asking whether it is'
expect_not_called "pr update-branch $PR"
expect_not_called "pr merge $PR --rebase"
expect_branch_unpushed "$before_sha"
end

# ==========================================================================================
# 20j. a formatter that FAILS aborts the merge and puts the worktree back
# ==========================================================================================
# The first case that reaches a failure path AFTER the worktree has been written to, and
# so the first one that can hold the section header to its claim that every such failure
# leaves the tree as it was found. Before it, every refusal happened during the read-only
# analysis, which made `expect_no_merge_in_progress` true by construction everywhere.
begin "a failing formatter aborts the merge and leaves the lane worktree as it was found"
td_fixture union-prettier-red
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
before_td=$(cat "$ROOT/wt/$TD")
must printf '3\n' >"$STATE/prettier.rc"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "prettier exited 3 over $TD"
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
st=$(git -C "$ROOT/wt" status --porcelain)
[ -z "$st" ] || bad "the abort left the lane worktree dirty: $st"
[ "$(cat "$ROOT/wt/$TD")" = "$before_td" ] ||
  bad "the abort did not restore the lane's own copy of $TD"
end

# ==========================================================================================
# 20k. the marker sweep runs AFTER the formatter, not before it
# ==========================================================================================
begin "conflict markers present after formatting are caught before anything is committed"
td_fixture union-markers
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must : >"$STATE/prettier.inject"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "the resolved $TD still holds conflict markers"
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
end

# ==========================================================================================
# 20l. a head this checkout and GitHub disagree about is refused
# ==========================================================================================
# The lease below it expects GitHub's headRefOid, and the analysis reads the local tip.
# If those are different commits the analysis answered about a branch nobody is merging.
begin "a PR head the lane worktree does not have is refused before the merge-tree call"
td_fixture union-tip-mismatch
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
V_OID="aaa111"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "but the PR's head is aaa111"
expect_stderr 'push it by hand and re-run'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
end

# ==========================================================================================
# 20m. the resolution consumes no update-branch attempt
# ==========================================================================================
# The attempt budget bounds the head-sha race; the union arm is bounded by its own
# one-pass flag. A run with MERGE_PR_UPDATE_RETRIES=1 must still merge — taking an
# attempt here would drop out of the loop with "gave up" AFTER a successful push.
begin "a union resolves and merges even with a single update-branch attempt allowed"
td_fixture union-one-attempt
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
td_views
capture -C "$REPO" env \
  MERGE_PR_GH_CMD="$ROOT/gh" MERGE_PR_REAP_CMD="$ROOT/reap" \
  MERGE_PR_PRETTIER_CMD="$ROOT/prettier" \
  MERGE_PR_POLL_INTERVAL_SECONDS=0 MERGE_PR_POLL_TIMEOUT_SECONDS=30 \
  MERGE_PR_RETRY_SECONDS=0 MERGE_PR_UPDATE_RETRIES=1 MERGE_PR_CONFIRM_RETRIES=2 \
  bash "$SUBJECT" "$PR" "$REPO"
expect_rc 0
expect_stdout "$TD unioned and pushed"
expect_not_stderr 'gave up after'
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 20n. a retried update-branch that WRITES waits past the union's own head
# ==========================================================================================
# Main moved again in the seconds between the push and the retry, so update-branch writes
# rather than answering the no-op. The head that write replaced is the sha the union
# pushed — not the one read at classify time — and comparing against the older one clears
# the await gate on the union's own head while the rollup being read belongs to the write.
# That is cumulo#501's shape reached through the new door, so the fixture answers exactly it:
# the poll's first read is the union's own sha, substituted at call time.
begin "a write after the union waits past the sha the union pushed, not the classify-time one"
td_fixture union-then-write
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
V_MSST="DIRTY"
write_view 1
V_MSST="BLOCKED"
write_view 2
must : >"$STATE/view.2.oid-from-wt"
V_OID="ddd444"
V_MSST="CLEAN"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout "$TD unioned and pushed"
expect_stdout 'updated onto the base (attempt 1)'
expect_stdout '2 check(s) complete on ddd444'
expect_not_stderr "mergeStateStatus is 'BLOCKED'"
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 20o. …and the head the union REPLACED is still stale too
# ==========================================================================================
# The companion to 20n, and the case that caught a defect the fix round planted. A run
# that unions and is then written over has superseded TWO heads: the one read at
# classify time and the one the union pushed. The await gate is an inequality, so a
# version that excluded only the newer of the two left the OLDER one admissible — and a
# lagging GitHub answers exactly that one. The fixture answers it: the poll's first read
# is the pre-union head, complete and CLEAN, which is the shape that merges on a rollup
# belonging to a commit two pushes ago.
begin "a lagging answer naming the head the union replaced is not read as the new head"
td_fixture union-oldest-stale
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
pre_union_head="$V_OID"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_WROTE" >"$STATE/update-branch.out"
V_MSST="DIRTY"
write_view 1
# The poll's first read: still the PRE-union head, and every check on it green — so a
# gate that let this through would break the poll here and merge on it.
V_MSST="CLEAN"
write_view 2
# Its second: the union's own head, which the write that followed has replaced.
V_MSST="BLOCKED"
write_view 3
must : >"$STATE/view.3.oid-from-wt"
V_OID="eee555"
V_MSST="CLEAN"
write_view default
write_merged_view
run_merge
expect_rc 0
expect_stdout "$TD unioned and pushed"
expect_stdout '2 check(s) complete on eee555'
expect_not_stdout "complete on $pre_union_head"
expect_not_stderr "mergeStateStatus is 'BLOCKED'"
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 20p. …and the head the union pushed is the one a no-op resume settles ON
# ==========================================================================================
# The other side of 20n/20o, and the one td_views cannot state: its settled read is a
# fixture sha, so every union case so far proves which heads are EXCLUDED and none
# proves which is admitted. When the retried update-branch answers the no-op, the head
# this run is waiting for IS the sha the union pushed — so excluding it there (the
# symmetrical mistake to the one 20o was written for) would burn the whole poll budget
# on a branch that was already current. The settled read is substituted from the lane
# worktree, and the assertion names the sha the run itself produced.
begin "a no-op resume settles on the head the union pushed, rather than waiting past it"
td_fixture union-settles-on-its-own-head
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
V_MSST="DIRTY"
write_view 1
V_MSST="CLEAN"
write_view default
must : >"$STATE/view.2.oid-from-wt"
write_merged_view
run_merge
union_sha=$(git -C "$ROOT/wt" rev-parse HEAD)
expect_rc 0
expect_stdout "$TD unioned and pushed"
expect_stdout "2 check(s) complete on $union_sha"
expect_called "pr merge $PR --squash"
end

# ==========================================================================================
# 20q. a header main edited EARLIER does not refuse a tail-only conflict
# ==========================================================================================
# Issue cumulo#525: cumulo#513's first live run (cumulo#524) refused a main whose header
# had acquired a restatement ledger in an earlier merge. Only one side made the edit, so
# it must (a) not refuse and (b) SURVIVE into what gets pushed, rather than being
# quietly reverted to the merge base.
begin "a clean header edit on main does not refuse a tail-only conflict, and survives the union"
td_fixture union-ledgered-header
td_main_writes "$TD_BASE_LEDGERED$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.1"
must printf '1\n' >"$STATE/update-branch.1.rc"
must printf '%s\n' "$UPDATE_NOOP" >"$STATE/update-branch.out"
td_views
run_merge
expect_rc 0
expect_stdout "$TD unioned and pushed"
expect_stdout 'base appended 1 entr(ies), the branch 1'
expect_stdout 'the header above the first entry had moved and merged cleanly'
expect_called "pr merge $PR --squash"
[ "$(origin_branch_sha)" != "$before_sha" ] || bad "the resolution was never pushed"
resolved=$(origin_branch_td)
case "$resolved" in
  *'Restatement ledger: the executable carrier is merge-pr.sh.'*) ;;
  *) bad "the union reverted main's header edit to the merge-base text" ;;
esac
main_at=$(printf '%s\n' "$resolved" | grep -n 'another lane merged first' | cut -d: -f1)
branch_at=$(printf '%s\n' "$resolved" | grep -n 'this lane logged' | cut -d: -f1)
[ -n "$main_at" ] || bad "the union dropped main's appended entry"
[ -n "$branch_at" ] || bad "the union dropped the branch's appended entry"
[ "${main_at:-0}" -lt "${branch_at:-0}" ] ||
  bad "main's entry must come first and the branch's after (main at $main_at, branch at $branch_at)"
expect_no_merge_in_progress
end

# ==========================================================================================
# 20r. …but a header BOTH sides moved incompatibly is still refused
# ==========================================================================================
# The other half of 20q, and what stops it from being a licence to union anything: the
# two sides changed the same header line to different text, which is a judgement call
# the merge owner takes and this step does not. Refused before the worktree is touched, so nothing is pushed and nothing merges.
begin "a header edit both sides made incompatibly is refused rather than unioned"
td_fixture union-header-conflict
td_main_writes "$TD_BASE_LEDGERED$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE_LEDGERED_OTHERWISE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr 'the conflict is not one this script may resolve'
expect_stderr "$TD: the header above the first entry was changed on both sides"
expect_stderr 'does not merge: git merge-file leaves 1 conflict(s) there'
expect_not_called "pr merge $PR --squash"
[ -f "$STATE/merged" ] && bad "the PR merged despite the refusal"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
[ -f "$STATE/prettier.log" ] && bad "prettier ran on a resolution that was refused"
end

# ==========================================================================================
# 20s. a side that retitled the base's final entry deleted it and appended the new title
# ==========================================================================================
# Entries are matched by heading, so a retitle reads as a deletion plus an addition: the
# other side left the old entry alone, so the deletion is authoritative.
begin "a retitled final entry is kept under its new title, with both appends after it"
td_fixture union-retitled
td_main_writes "$TD_BASE_RENAMED$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
conflict_once
td_views
run_merge
expect_union "$TD" "$TD_BASE_RENAMED$TD_MAIN_ENTRY$TD_BRANCH_ENTRY"
expect_stdout 'base appended 2 entr(ies), the branch 1; 1 deleted; 3 entr(ies) in all'
end

# ==========================================================================================
# 20s-ii. an entry inserted ABOVE one the base already had is refused
# ==========================================================================================
begin "a side that inserts a new entry above an existing one is refused"
td_fixture union-inserted
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "${TD_BASE%%## *}## 2026-09-05 — an entry slipped in above

- Where: the branch

## ${TD_BASE#*## }$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$TD: the branch side adds the entry \"## 2026-09-05 — an entry slipped in above\" above" \
  'never inserted above one'
end

begin "a base side that inserted a new entry above an existing one is refused too"
td_fixture union-inserted-on-main
td_main_writes "${TD_BASE%%## *}## 2026-09-05 — an entry main slipped in above

- Where: main

## ${TD_BASE#*## }$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$TD: the base side adds the entry \"## 2026-09-05 — an entry main slipped in above\" above"
end

# ==========================================================================================
# 20t. a base that repeats an entry heading matches nothing
# ==========================================================================================
# Two entries titled identically cannot be matched across the three copies, so the base
# is refused rather than merged at a guess.
begin "a merge base that repeats an entry heading verbatim is refused"
td_fixture union-heading-doubled
must printf '%s' "$TD_BASE_DOUBLED" >"$REPO/$TD"
must gitc "$REPO" commit --quiet -am 'the log grows a second entry with the same title'
must gitc "$REPO" push --quiet origin main
must gitc "$REPO" worktree remove --force "$ROOT/wt"
must gitc "$REPO" branch -D "$HEAD_REF" >/dev/null
must gitc "$REPO" worktree add --quiet -b "$HEAD_REF" "$ROOT/wt" HEAD
td_main_writes "$TD_BASE_DOUBLED$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE_DOUBLED$TD_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "$TD: the merge-base copy holds 2 entries headed"
expect_stderr 'a heading repeated verbatim matches nothing'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
end

# ==========================================================================================
# 20u. …and so does a side that appends a second copy of one
# ==========================================================================================
# The same guard on a side: the base is fine and the BRANCH appends an entry whose
# heading is character-for-character one the base already had.
begin "a side that appends a second copy of an existing entry heading is refused"
td_fixture union-heading-reused
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY_REUSING_HEADING"
before_sha=$(origin_branch_sha)
must printf '%s\n' "$UPDATE_CONFLICT" >"$STATE/update-branch.out"
must printf '1\n' >"$STATE/update-branch.rc"
td_views
run_merge
expect_rc 1
expect_stderr 'update-branch — FAILED'
expect_stderr "$TD: the branch copy holds 2 entries headed"
expect_stderr 'a heading repeated verbatim matches nothing'
expect_not_called "pr merge $PR --squash"
expect_branch_unpushed "$before_sha"
expect_no_merge_in_progress
end

# ==========================================================================================
# 20v. docs/review-feedback.md: both sides append one entry — unioned, base first
# ==========================================================================================
# The issue's first fixture (#60): the union holds main's entries plus the one the
# branch added.
begin "two lanes that both appended a review-feedback entry are unioned, base first"
td_fixture union-feedback "$RF" "$RF_BASE"
main_writes "$RF" "$RF_BASE$RF_MAIN_ENTRY"
branch_writes "$RF" "$RF_BASE$RF_BRANCH_ENTRY"
conflict_once
td_views
run_merge
expect_union "$RF" "$RF_BASE$RF_MAIN_ENTRY$RF_BRANCH_ENTRY"
expect_stdout "$RF unioned and pushed ($RF: base appended 1 entr(ies), the branch 1; 5 entr(ies) in all)"
# Headings outside fences, counted independently of the subject's own parser.
count_headings() { awk '/^```/ { fenced = !fenced; next } !fenced && /^## / { n++ } END { print n + 0 }'; }
main_count=$(printf '%s' "$RF_BASE$RF_MAIN_ENTRY" | count_headings)
union_count=$(origin_branch_file "$RF" | count_headings)
[ "$union_count" -eq $((main_count + 1)) ] ||
  bad "the union holds $union_count entries, expected main's $main_count + 1"
grep -qxF -- "--write $RF" "$STATE/prettier.log" ||
  bad "prettier was not run over $RF (log: $(cat "$STATE/prettier.log" 2>/dev/null))"
end

# ==========================================================================================
# 20w. an entry main deleted and the branch edited is refused
# ==========================================================================================
# A deletion is authoritative only over text the other side left alone; against an edit
# it is a judgement call, and the issue's second fixture (#60).
begin "a branch edit to an entry main deleted is refused, naming the entry"
td_fixture union-delete-vs-edit "$RF" "$RF_BASE"
main_writes "$RF" "$RF_KEPT$RF_MAIN_ENTRY"
branch_writes "$RF" "$RF_KEPT$RF_DOOMED_EDITED$RF_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$RF: the base side deletes the entry \"## 2026-10-02 — PR #2 — the entry main deletes\", which the branch side edits" \
  'a deletion is authoritative only over an entry the other side left as it was'
end

begin "a branch deletion of an entry main edited is refused, naming the entry"
td_fixture union-edit-vs-delete "$RF" "$RF_BASE"
main_writes "$RF" "$RF_KEPT$RF_DOOMED_EDITED$RF_MAIN_ENTRY"
branch_writes "$RF" "$RF_KEPT$RF_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$RF: the branch side deletes the entry \"## 2026-10-02 — PR #2 — the entry main deletes\", which the base side edits"
end

# A log deleted on one side is a modify/delete conflict on that path, and its "union"
# would be the other side's additions alone, headerless.
begin "a log main deleted while the branch appended to it is refused"
td_fixture union-log-deleted "$FL" "$FL_BASE"
must gitc "$REPO" rm --quiet "$FL"
must gitc "$REPO" commit --quiet -m 'another lane deleted the log'
must gitc "$REPO" push --quiet origin main
branch_writes "$FL" "$FL_BASE$FL_60"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$FL: the base side has no copy of this file"
end

# ==========================================================================================
# 20x. docs/friction-log.md: the branch consumed entries while main appended one
# ==========================================================================================
# The issue's third fixture, in PR #61's shape: the branch's deletion and its trim both
# stand, main's append is kept, and the untouched entry is untouched.
begin "a friction-log branch that deleted and trimmed entries beside main's append is unioned"
td_fixture union-friction "$FL" "$FL_BASE"
main_writes "$FL" "$FL_BASE$FL_58"
branch_writes "$FL" "$FL_HEAD$FL_33$FL_48_TRIMMED"
conflict_once
td_views
run_merge
expect_union "$FL" "$FL_HEAD$FL_33$FL_48_TRIMMED$FL_58"
expect_stdout "$FL: base appended 1 entr(ies), the branch 0; 1 deleted; 1 edited in place; 3 entr(ies) in all"
end

# ==========================================================================================
# 20y. two logs conflicted in one update are unioned in one commit
# ==========================================================================================
begin "a conflicted set of two append-only logs is unioned whole, both files in one commit"
td_fixture union-two-logs "$FL" "$FL_BASE"
main_writes "$TD" "$TD_BASE$TD_MAIN_ENTRY" "$FL" "$FL_BASE$FL_58"
branch_writes "$TD" "$TD_BASE$TD_BRANCH_ENTRY" "$FL" "$FL_BASE$FL_60"
conflict_once
td_views
run_merge
expect_union "$TD" "$TD_BASE$TD_MAIN_ENTRY$TD_BRANCH_ENTRY"
expect_union "$FL" "$FL_BASE$FL_58$FL_60"
expect_stdout "$FL: base appended 1 entr(ies), the branch 1; 5 entr(ies) in all | $TD: base appended 1 entr(ies), the branch 1; 3 entr(ies) in all"
grep -qxF -- "--write $FL $TD" "$STATE/prettier.log" ||
  bad "prettier was not run over both logs in one call (log: $(cat "$STATE/prettier.log" 2>/dev/null))"
subject=$(git -C "$ROOT/origin.git" log -1 --format=%s "$HEAD_REF")
[ "$subject" = "#12: $FL, $TD — union with 'main' (both sides' entries kept)" ] ||
  bad "the resolution commit's subject is $subject"
end

# ==========================================================================================
# 20z. the remaining shapes the plan refuses: a reorder, a heading both sides added, and
#      an unclosed fence
# ==========================================================================================
begin "a side that reorders entries the base already had is refused"
td_fixture union-reorder "$RF" "$RF_BASE"
main_writes "$RF" "$RF_BASE$RF_MAIN_ENTRY"
branch_writes "$RF" "${RF_KEPT%%## 2026-10-01*}${RF_DOOMED#
}
## 2026-10-01${RF_KEPT#*## 2026-10-01}$RF_BRANCH_ENTRY"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$RF: the branch side moves the entry \"## 2026-10-01 — PR #1 — the entry that was already here\" above" \
  'never reorders it'
end

begin "an entry heading both sides added is refused rather than chosen between"
td_fixture union-same-heading
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE${TD_MAIN_ENTRY%- Source: #2
}- Source: #3
"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$TD: both sides add an entry headed \"## 2026-09-11 — the entry another lane merged first\""
end

begin "a side whose copy ends inside an unclosed fence is refused"
td_fixture union-open-fence
td_main_writes "$TD_BASE$TD_MAIN_ENTRY"
td_branch_writes "$TD_BASE$TD_BRANCH_ENTRY
\`\`\`
## not a heading, but nothing closes the fence
"
before_sha=$(origin_branch_sha)
conflict_always
td_views
run_merge
expect_union_refused "$before_sha" \
  "$TD: the branch copy ends inside an unclosed code fence"
end

# ==========================================================================================
# 18. usage
# ==========================================================================================
begin "a missing or non-numeric PR number is a usage error, and nothing is called"
fixture usage
write_view default
capture -C "$REPO" env MERGE_PR_GH_CMD="$ROOT/gh" bash "$SUBJECT"
expect_rc 2
expect_stderr 'usage: merge-pr.sh'
case_ctx="non-numeric"
capture -C "$REPO" env MERGE_PR_GH_CMD="$ROOT/gh" bash "$SUBJECT" "#490"
expect_rc 2
expect_stderr 'must be a number'
case_ctx=""
[ -s "$STATE/calls.log" ] && bad "gh was called for a run that never got past argument parsing"
end

# ==========================================================================================
# 19. a non-numeric knob is refused rather than silently changing a gate
# ==========================================================================================
begin "a non-numeric env knob is a usage error"
fixture knob
write_view default
capture -C "$REPO" env MERGE_PR_GH_CMD="$ROOT/gh" MERGE_PR_EXPECTED_CHECKS=lots \
  bash "$SUBJECT" "$PR" "$REPO"
expect_rc 2
expect_stderr 'MERGE_PR_EXPECTED_CHECKS must be a non-negative integer'
case_ctx="zero time box"
capture -C "$REPO" env MERGE_PR_GH_CMD="$ROOT/gh" MERGE_PR_GH_TIMEOUT_SECONDS=0 \
  bash "$SUBJECT" "$PR" "$REPO"
expect_rc 2
expect_stderr 'MERGE_PR_GH_TIMEOUT_SECONDS must be at least 1'
case_ctx=""
end

finish
