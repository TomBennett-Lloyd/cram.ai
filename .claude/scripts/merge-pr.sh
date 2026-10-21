#!/usr/bin/env bash
#
# The merge ritual, as one idempotent script.
#
# The merge owner ran this chain by hand for every PR — update-branch first, a
# pending-aware checks poll, merge only on CLEAN, squash for a single issue and
# rebase for a batch, and for a humanAlways PR the review-feedback verdict on the
# branch before the merge and the label off only after it. Retyped each time, it
# failed in every way a hand-typed chain can: one chain took the label off on
# CI-green rather than on merge (cumulo#469), one skipped update-branch and hit
# BEHIND (cumulo#484), and one died mid-poll on `error connecting to api.github.com`
# and left the PR open with no signal at all (cumulo#488). docs/friction-log.md's
# 2026-09-11 entry records the class.
#
# So the chain is a script, and the property that matters most is that it is
# RE-RUNNABLE FROM ANY STATE. Nothing is remembered between runs; every step
# reads the PR's current state and decides whether it is still owed. A run that
# dies mid-poll is repaired by running it again, which is also why every failure
# exits non-zero with the STEP named — the name is where the next run resumes.
#
# What this script will never do is fill in a verdict. A humanAlways PR whose
# docs/review-feedback.md entry still carries the literal `pending — filled at
# merge` placeholder is REFUSED, because that placeholder means the owner has not
# decided yet, and the whole point of the form (docs/review-feedback.md's
# `## Entry format`) is that a filled verdict stays distinguishable from an
# unfilled one. CI's merge-ritual-gate cannot make that distinction —
# .github/workflows/ci.yml comment (d) says so in terms: it sees that the file is
# in the diff and nothing beyond that, so a placeholder clears it exactly as a
# real entry does. This refusal is that gap, and it is the one step here that is
# a gate rather than a convenience. The fill itself is
# .claude/scripts/fill-verdict.sh, run on the branch once the owner has decided.
#
# Usage:
#   merge-pr.sh [--method squash|rebase] <pr-number> [repo-root]
#
#     pr-number   the PR to merge
#     repo-root   the repository to act in (default: the one holding this script)
#     --method    override the squash/rebase inference (see the classify step)
#
# Exit:  0 the chain completed (or had already completed on an earlier run)
#        1 a step failed or refused — the message names it; fix the cause and re-run
#        2 the script could not reach a verdict at all (usage, no node, no repo)
#
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

# The caller's working directory, captured BEFORE anything cds: the worktree step
# must never reap the directory the operator is standing in, and after a `cd` to
# the repository root there is no way left to ask where that was.
caller_cwd="$PWD"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./worktree-lib.sh
. "$script_dir/worktree-lib.sh"

# Env knobs, all overridable — the harness pins the waits to zero, and an operator
# on a slow lane can widen the poll without editing the script. Every *_RETRIES
# knob counts ATTEMPTS, the first included, so each is at least 1 (#180).
: "${MERGE_PR_GH_CMD:=gh}"                             # GitHub CLI
: "${MERGE_PR_REAP_CMD:=$script_dir/reap-worktree.sh}" # the reaper, which owns its own safety checks
: "${MERGE_PR_POLL_INTERVAL_SECONDS:=20}"              # between checks polls
: "${MERGE_PR_POLL_TIMEOUT_SECONDS:=1800}"             # total budget for the checks poll
: "${MERGE_PR_UPDATE_RETRIES:=3}"                      # update-branch attempts against the head-sha race
: "${MERGE_PR_RETRY_SECONDS:=10}"                      # between those attempts, between state re-reads, and after a union push
: "${MERGE_PR_EXPECTED_CHECKS:=0}"                     # a floor the operator can raise; see the checks step
: "${MERGE_PR_CONFIRM_RETRIES:=5}"                     # reads of an eventually-consistent state; see the merge and issues steps
: "${MERGE_PR_PRETTIER_CMD:=pnpm exec prettier}"       # formatter the append-only-log union re-runs; see that step
: "${MERGE_PR_GH_TIMEOUT_SECONDS:=60}"                 # the time box on every gh call; see gh_call
: "${MERGE_PR_READ_RETRIES:=4}"                        # consecutive failed checks-poll reads that fail the step
: "${MERGE_PR_UNION_SEAM:=}"                           # unset outside merge-pr.test.sh; see log_union

# `files` is deliberately NOT in this list. `gh pr view --json files` is
# `files(first: 100)` with no truncation signal, and the humanAlways decision made
# off a silently-truncated file list fails in the one direction that cannot be
# taken back: a PR touching CLAUDE.md as its 120th file would classify AUTO and
# merge without the owner. The file list is read separately and paginated, the
# same endpoint and flags .github/workflows/ci.yml's merge-ritual-gate step uses
# to read the same list (its comment (c) is about why that job needs no checkout,
# which is a different argument — what is borrowed here is the call, not the
# reasoning). `commits` carries the same cap and is left on this list: it feeds
# only the curated-history check, whose first test is a count comparison against
# the Closes count, so a list truncated at 100 refuses rather than merges for any
# PR closing fewer than 100 issues.
PR_JSON_FIELDS='baseRefName,body,commits,headRefName,headRefOid,labels,mergeStateStatus,number,state,statusCheckRollup,url'

# The numeric knobs are validated here rather than where they are used. Under
# `set -u` without `set -e`, a `[ "$x" -gt 0 ]` on a non-numeric value prints an
# error, returns 2, and the script carries on with whichever branch that happens
# to select — so a fat-fingered override would silently change a gate. Refusing
# up front makes it a usage error instead.
for knob in MERGE_PR_POLL_INTERVAL_SECONDS MERGE_PR_POLL_TIMEOUT_SECONDS \
  MERGE_PR_UPDATE_RETRIES MERGE_PR_RETRY_SECONDS MERGE_PR_EXPECTED_CHECKS \
  MERGE_PR_CONFIRM_RETRIES MERGE_PR_GH_TIMEOUT_SECONDS MERGE_PR_READ_RETRIES; do
  case "${!knob}" in
    '' | *[!0-9]*)
      printf 'merge-pr: %s must be a non-negative integer, got "%s"\n' "$knob" "${!knob}" >&2
      exit 2
      ;;
  esac
done
# A zero time box would kill every gh call before it answered.
if [ "$MERGE_PR_GH_TIMEOUT_SECONDS" -lt 1 ]; then
  printf 'merge-pr: MERGE_PR_GH_TIMEOUT_SECONDS must be at least 1, got "%s"\n' "$MERGE_PR_GH_TIMEOUT_SECONDS" >&2
  exit 2
fi
for knob in MERGE_PR_UPDATE_RETRIES MERGE_PR_CONFIRM_RETRIES MERGE_PR_READ_RETRIES; do
  if [ "${!knob}" -lt 1 ]; then
    printf 'merge-pr: %s counts attempts and must be at least 1, got "%s"\n' "$knob" "${!knob}" >&2
    exit 2
  fi
done

usage() {
  cat >&2 <<'EOF'
usage: merge-pr.sh [--method squash|rebase] <pr-number> [repo-root]

  pr-number   the PR to merge
  repo-root   the repository to act in (default: the one holding this script)
  --method    override the squash/rebase inference (see the classify step)

Exit: 0 chain complete, 1 a step failed or refused (a re-run resumes there), 2 no verdict.
EOF
  exit 2
}

pr_number=""
repo_root=""
method_override=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage ;;
    --method)
      shift
      case "${1-}" in
        squash | rebase) method_override="$1" ;;
        *)
          printf 'merge-pr: --method takes squash or rebase, got "%s"\n' "${1-}" >&2
          usage
          ;;
      esac
      ;;
    -*)
      printf 'merge-pr: unknown option %s\n' "$1" >&2
      usage
      ;;
    *)
      if [ -z "$pr_number" ]; then
        pr_number="$1"
      elif [ -z "$repo_root" ]; then
        repo_root="$1"
      else
        printf 'merge-pr: expected at most two arguments, got a third: %s\n' "$1" >&2
        usage
      fi
      ;;
  esac
  shift
done

[ -n "$pr_number" ] || usage
case "$pr_number" in
  '' | *[!0-9]*)
    printf 'merge-pr: <pr-number> must be a number, got "%s"\n' "$pr_number" >&2
    usage
    ;;
esac

if [ -z "$repo_root" ]; then
  repo_root=$(git -C "$script_dir" rev-parse --show-toplevel) || {
    printf 'merge-pr: %s is not inside a git repository, and no repo-root was given\n' "$script_dir" >&2
    exit 2
  }
fi
[ -d "$repo_root" ] || {
  printf 'merge-pr: %s is not a directory\n' "$repo_root" >&2
  exit 2
}
repo_root=$(canon "$repo_root") || exit 2
caller_cwd=$(canon "$caller_cwd") || exit 2

# Every `gh` call infers its repository from the working directory, so the whole
# chain runs from the repository root rather than from wherever the operator was.
cd "$repo_root" || exit 2

# --- reporting ------------------------------------------------------------------------------
#
# One line per step on stdout, and nothing else there: a run's transcript is meant
# to read as the ritual it performs. Diagnostics go to stderr, where they cannot
# be mistaken for a step that happened.

step() { # step <name> <detail>
  printf 'merge-pr: %s — %s\n' "$1" "$2"
}

fail() { # fail <step> <message> — exit 1, naming the step a re-run resumes from
  printf 'merge-pr: %s — FAILED: %s\n' "$1" "$2" >&2
  printf 'merge-pr: nothing after "%s" ran. Fix the cause and re-run "merge-pr.sh %s"; it resumes from that step.\n' "$1" "$pr_number" >&2
  exit 1
}

# Deferred failures: things that are wrong but that no longer have anything to
# stop. Once the PR is merged, an unclosed `Closes` issue or an unfilled verdict
# can only be reported, so the remaining post-merge steps still run and the run
# ends non-zero with all of them named at once.
deferred=()
defer() { # defer <step> <message>
  deferred+=("$1 — $2")
}

# --- JSON, read by node ----------------------------------------------------------------------
#
# node is the repo's declared runtime (package.json engines) and worktree-lib.sh
# has already refused to load without it. The `gh pr view` answer is parsed by
# pr-facts.mjs, the parser fill-verdict.sh shares; that file's header owns the
# record format.

pr_facts() { # stdin: a `gh pr view --json` object; stdout: pr-facts.mjs's records
  node "$script_dir/pr-facts.mjs"
}

json_field() { # json_field <key>; stdin: a JSON object; stdout: that key as a string
  node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try {
    const o = JSON.parse(raw);
    const v = o[process.argv[1]];
    process.stdout.write((v == null ? "" : String(v)) + "\n");
  } catch (e) {
    process.stderr.write("expected a JSON object: " + e.message + "\n");
    process.exit(2);
  }
});
' "$1"
}

# --- gh, time-boxed --------------------------------------------------------------------------

# gh_call <gh args…> -> gh's stdout and stderr on stdout, and gh's exit code; 124
# when the call outlived MERGE_PR_GH_TIMEOUT_SECONDS and was killed.
#
# Every gh call in this script goes through here, so that a request that never
# answers fails its step instead of freezing it (issue #55). Neither `timeout` nor `gtimeout`
# can be assumed to exist (the owner's machine has neither) and gh documents no
# request timeout of its own, so the box is a watchdog written for bash 3.2.
# gh's output goes to a file, never to the caller's pipe: the caller captures with
# `$(…)`, which waits for every process holding that pipe to close it, and the
# watchdog would then make every call take the full box.
gh_call() {
  local out_file pid watcher rc
  out_file=$(mktemp "${TMPDIR:-/tmp}/merge-pr-gh.XXXXXX") || {
    printf 'merge-pr: could not create a temp file for gh output\n'
    return 2
  }
  "$MERGE_PR_GH_CMD" "$@" >"$out_file" 2>&1 &
  pid=$!
  # The watcher's own sleep must die with it. A TERM can land between `sleep &`
  # and `spid=$!`, when the trap has no pid to kill, so the trap also sets a flag
  # that is checked once the pid is known.
  (
    stop=0
    spid=""
    trap 'stop=1; [ -n "$spid" ] && kill "$spid" 2>/dev/null' TERM
    sleep "$MERGE_PR_GH_TIMEOUT_SECONDS" &
    spid=$!
    [ "$stop" = 1 ] && kill "$spid" 2>/dev/null
    wait "$spid"
    [ "$stop" = 1 ] && exit 0
    : >"$out_file.timed-out"
    kill -TERM "$pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  watcher=$!
  wait "$pid"
  rc=$?
  kill -TERM "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  cat "$out_file"
  if [ -e "$out_file.timed-out" ]; then
    printf 'merge-pr: gh %s did not answer within %ss and was killed\n' "$*" "$MERGE_PR_GH_TIMEOUT_SECONDS"
    rc=124
  fi
  rm -f "$out_file" "$out_file.timed-out"
  return "$rc"
}

# --- PR state ---------------------------------------------------------------------------------

pr_state=""
pr_base_ref=""
pr_head_ref=""
pr_head_sha=""
pr_merge_state=""
pr_url=""
pr_labels=()
pr_closes=()
pr_lanes=()
pr_batches=()
pr_commits=()
check_names=()
check_statuses=()
check_conclusions=()
last_error=""

read_pr() { # read_pr -> 0 and the globals refreshed, or 1 with $last_error set
  local json facts rc kind a b c
  json=$(gh_call pr view "$pr_number" --json "$PR_JSON_FIELDS" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    last_error="gh pr view exited $rc: $json"
    return 1
  fi
  facts=$(printf '%s' "$json" | pr_facts 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    last_error="could not parse gh's answer: $facts"
    return 1
  fi

  pr_state=""
  pr_base_ref=""
  pr_head_ref=""
  pr_head_sha=""
  pr_merge_state=""
  pr_url=""
  pr_labels=()
  pr_closes=()
  pr_lanes=()
  pr_batches=()
  pr_commits=()
  check_names=()
  check_statuses=()
  check_conclusions=()

  # A heredoc, not a pipe: piping into the loop would run it in a subshell and
  # every global it sets would be discarded at the closing `done`.
  while IFS=$'\t' read -r kind a b c; do
    case "$kind" in
      state) pr_state="$a" ;;
      baseRefName) pr_base_ref="$a" ;;
      headRefName) pr_head_ref="$a" ;;
      headRefOid) pr_head_sha="$a" ;;
      mergeStateStatus) pr_merge_state="$a" ;;
      url) pr_url="$a" ;;
      label) pr_labels+=("$a") ;;
      closes) pr_closes+=("$a") ;;
      lane) pr_lanes+=("$a") ;;
      batch) pr_batches+=("$a") ;;
      commit) pr_commits+=("$a") ;;
      check)
        check_names+=("$a")
        check_statuses+=("$b")
        check_conclusions+=("$c")
        ;;
    esac
  done <<EOF
$facts
EOF

  if [ -z "$pr_state" ]; then
    last_error="gh's answer carried no PR state — PR #$pr_number may not exist"
    return 1
  fi
  return 0
}

read_pr || fail 'classify' "$last_error"

case "$pr_state" in
  OPEN | MERGED) ;;
  CLOSED) fail 'classify' "PR #$pr_number is CLOSED without being merged — there is no ritual to run" ;;
  *) fail 'classify' "PR #$pr_number is in an unrecognised state '$pr_state'" ;;
esac

already_merged=0
[ "$pr_state" = "MERGED" ] && already_merged=1

# --- step: classify ----------------------------------------------------------------------------
#
# Two independent classifications, and every refusal the MERGE-METHOD one implies
# taken HERE — before update-branch has touched the branch and before the poll has
# spent a CI round. A refusal that arrives at the merge step has already cost what
# it exists to save. (The humanAlways classification's own refusal is the feedback
# step below, which needs a second call to read the diff; it still lands before
# update-branch, which is the property that matters.)

# "Batch" is a run-issue lane property — `orchestration.routeRule`'s 2-6 members,
# one agent, one in-flight row — and a Closes count only correlates with it: PRs
# cumulo#611 and cumulo#626, each one ticket-agent lane that also closed a second issue,
# carried two Closes lines and were refused as batches. So the lane's own
# declaration is read first, and the Closes count decides only for a body with
# none. Two declarations in one body say nothing this script can act on, so they
# refuse.
merge_method=""
if [ $((${#pr_lanes[@]} + ${#pr_batches[@]})) -gt 1 ]; then
  merge_reason="$((${#pr_lanes[@]} + ${#pr_batches[@]})) lane declarations (lane reports, batch TASK REPORT headers) in one PR body"
elif [ "${#pr_batches[@]}" -eq 1 ]; then
  merge_method="--rebase"
  merge_reason="task-orchestrator batch, anchor #${pr_batches[0]} -> rebase"
elif [ "${#pr_lanes[@]}" -eq 1 ]; then
  # The lane closes its own issue (.claude/agents/ticket-agent.md rule 7); a report
  # whose issue no Closes line names is refused rather than merged with it left open.
  case " ${pr_closes[*]-} " in
    *" ${pr_lanes[0]} "*)
      merge_method="--squash"
      merge_reason="ticket-agent lane for #${pr_lanes[0]} -> squash"
      ;;
    *) merge_reason="the lane report names #${pr_lanes[0]} but no Closes line does" ;;
  esac
else
  # A body with no lane declaration has one more declaration to read: the head
  # branch is cut as `<n>-<slug>` (.claude/skills/execute/SKILL.md step 1,
  # .claude/agents/ticket-agent.md § 1), and that leading number names the
  # ticket. When the Closes list names it too and no commit subject names
  # another Closes issue, the PR is that one ticket — the other Closes lines are
  # issues the same diff resolved on the way, not batch members (#27). The
  # commit-subject guard is what keeps a header-less task-orchestrator batch,
  # which also sits on an `<n>-<slug>` branch with its anchor among the Closes,
  # on the rebase arm: a curated batch names each member in a subject. A branch
  # number no Closes line names says nothing, and the count decides. The commit
  # count test is for bash 3.2, which under `set -u` aborts on an empty `[@]`.
  head_issue=""
  [[ "$pr_head_ref" =~ ^([0-9]+)- ]] && head_issue="${BASH_REMATCH[1]}"
  other_member=""
  if [ -n "$head_issue" ] && [ "${#pr_closes[@]}" -gt 1 ] && [ "${#pr_commits[@]}" -gt 0 ]; then
    for n in "${pr_closes[@]}"; do
      [ "$n" = "$head_issue" ] && continue
      for m in "${pr_commits[@]}"; do
        case "$m" in
          *"#$n"*)
            other_member=$n
            break 2
            ;;
        esac
      done
    done
  fi
  case "${#pr_closes[@]}" in
    0) merge_reason="no Closes line in the PR body" ;;
    1)
      merge_method="--squash"
      merge_reason="single issue #${pr_closes[0]} -> squash"
      ;;
    *)
      closes_list=$(printf ' #%s' "${pr_closes[@]}")
      if [ -n "$head_issue" ] && [ -z "$other_member" ] && [[ " ${pr_closes[*]} " == *" $head_issue "* ]]; then
        also=""
        for n in "${pr_closes[@]}"; do
          [ "$n" = "$head_issue" ] || also+=" #$n"
        done
        merge_method="--squash"
        merge_reason="single issue #$head_issue by head branch '$pr_head_ref', also closing$also -> squash"
      else
        merge_method="--rebase"
        merge_reason="batch of ${#pr_closes[@]} issues (${closes_list# }) -> rebase"
      fi
      ;;
  esac
fi

# An explicit --method overrides the inference, which stays a heuristic for any
# body without a declaration: cumulo#414 carried four Closes lines and was
# squash-merged. An operator who knows the lane says so and is believed.
if [ -n "$method_override" ]; then
  merge_method="--$method_override"
  merge_reason="$merge_reason, overridden to $method_override"
fi

# The changed-file list, paginated. `--paginate` is what makes the answer the
# whole PR rather than its first 100 files — the PR_JSON_FIELDS comment above says
# why that matters here.
pr_files=()
files_out=$(gh_call api "repos/{owner}/{repo}/pulls/$pr_number/files" \
  --paginate --jq '.[].filename' 2>&1)
files_rc=$?
[ "$files_rc" -eq 0 ] || fail 'classify' "could not read the changed-file list (gh api exited $files_rc): $files_out"
while IFS= read -r path; do
  [ -n "$path" ] || continue
  pr_files+=("$path")
done <<EOF
$files_out
EOF
# A PR with no files is not a thing GitHub produces, so an empty list means the
# read answered something this script does not understand — and an empty list is
# exactly what classifies every humanAlways PR as AUTO.
[ "${#pr_files[@]}" -gt 0 ] || fail 'classify' "the changed-file list came back empty for PR #$pr_number — refusing to classify humanAlways against nothing"

# humanAlways matching, against the list .claude/workflow.json owns. The glob
# subset understood is exactly two shapes — a literal path, and a `<dir>/**`
# prefix — and a pattern of any other shape is REFUSED rather than quietly
# treated as a literal, because the failure direction of a mis-read pattern is a
# humanAlways PR classified AUTO and merged without the owner ever seeing it.
human_hits=$(node -e '
const fs = require("fs");
let wf;
try {
  wf = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch (e) {
  process.stderr.write("could not read the humanAlways list: " + e.message + "\n");
  process.exit(2);
}
const pats = wf && wf.merge && wf.merge.humanAlways;
if (!Array.isArray(pats) || pats.length === 0) {
  process.stderr.write("merge.humanAlways is missing or empty in " + process.argv[1] + "\n");
  process.exit(2);
}
const files = process.argv.slice(2);
const hits = [];
for (const p of pats) {
  let match;
  if (typeof p !== "string" || p.length === 0) {
    process.stderr.write("merge.humanAlways holds a pattern that is not a non-empty string\n");
    process.exit(3);
  } else if (p.endsWith("/**")) {
    const prefix = p.slice(0, -2); // keeps the trailing slash: docs/adr/** -> docs/adr/
    if (/[*?[\]]/.test(prefix)) {
      process.stderr.write("unsupported humanAlways pattern: " + p + "\n");
      process.exit(3);
    }
    match = (f) => f.startsWith(prefix);
  } else if (/[*?[\]]/.test(p)) {
    process.stderr.write("unsupported humanAlways pattern: " + p + "\n");
    process.exit(3);
  } else {
    match = (f) => f === p;
  }
  for (const f of files) if (match(f) && !hits.includes(f)) hits.push(f);
}
process.stdout.write(hits.join(" "));
' "$repo_root/.claude/workflow.json" ${pr_files[@]+"${pr_files[@]}"} 2>&1)
human_rc=$?
[ "$human_rc" -eq 0 ] || fail 'classify' "cannot classify humanAlways: $human_hits"

is_human=0
class_summary="AUTO"
if [ -n "$human_hits" ]; then
  is_human=1
  class_summary="HUMAN (humanAlways: $human_hits)"
fi

curated_history_ok() { # -> 0, or 1 with the reason on stdout
  # .claude/skills/run-issue/SKILL.md step 4 makes --rebase conditional on this:
  # one commit per surviving member, each naming its member issue. A script that
  # took the rebase branch without checking would merge batches on terms the repo
  # forbids, so the check travels with the branch that needs it.
  local n m found
  if [ "${#pr_commits[@]}" -ne "${#pr_closes[@]}" ]; then
    printf 'curated history: %s commit(s) for %s member issue(s) — a batch merges --rebase only when those match\n' \
      "${#pr_commits[@]}" "${#pr_closes[@]}"
    return 1
  fi
  for n in "${pr_closes[@]}"; do
    found=0
    for m in "${pr_commits[@]}"; do
      case "$m" in
        *"#$n"*)
          found=1
          break
          ;;
      esac
    done
    if [ "$found" = "0" ]; then
      printf 'curated history: no commit subject references member issue #%s\n' "$n"
      return 1
    fi
  done
  return 0
}

step 'classify' "PR #$pr_number is $pr_state on '$pr_head_ref'; $merge_reason; $class_summary"

# Deferring these to the merge step would mean refusing AFTER
# update-branch had written to the branch and the poll had waited out a full CI
# run — the cost this script exists to save.
if [ "$already_merged" = "0" ]; then
  [ -n "$merge_method" ] || fail 'classify' \
    "$merge_reason — cannot tell a single-issue squash from a batch rebase. Correct the Closes lines or the lane declarations in the body, or pass --method squash|rebase"
  # Ahead of the curated-history check, so that a HUMAN batch carrying its
  # verdict commit is told the rule rather than a commit count; a batch whose
  # verdict was folded by hand would pass that count (#105). Naming the member is
  # the merge owner's FIX bounce (.claude/skills/run-issue/SKILL.md step 4).
  if [ "$merge_method" = "--rebase" ] && [ "$is_human" = "1" ]; then
    fail 'classify' "a --rebase PR classifies HUMAN (humanAlways: $human_hits), and a batch never carries a humanAlways path (.claude/workflow.json → orchestration.routeRule, #56) — bounce the batch to drop the member whose footprint reaches $human_hits, which runs as its own ticket-agent lane, or pass --method squash if this PR is a single issue"
  fi
  if [ "$merge_method" = "--rebase" ]; then
    curated_reason=$(curated_history_ok) || fail 'classify' "$curated_reason"
  fi
fi

# --- step: feedback ---------------------------------------------------------------------------
#
# humanAlways only. What is read is the branch's ADDED lines to
# docs/review-feedback.md, straight out of the PR diff, because that is exactly
# the set of lines this PR is responsible for: the entry for this PR is by
# construction something the branch added, and an entry an earlier PR left behind
# is not this run's business. Matching the heading against the PR number would be
# wrong — the declared heading form is `## YYYY-MM-DD — [PR/issue #n — ]<slug>`,
# and real entries use the `issue #n` spelling as often as the `PR #n` one.
#
# The placeholder is looked for in the two FIELDS that declare it, not anywhere in
# the added text. docs/review-feedback.md's own `## Entry format` section quotes
# the literal while explaining it, so a PR editing that section — itself a
# plausible humanAlways change — would otherwise be refused with a message about
# an unfilled verdict it does not have. Safe direction, wrong diagnosis, and a
# refusal whose stated reason is false teaches the reader to stop believing it.
#
# What this step reads is the PATH docs/review-feedback.md and the LITERAL
# "pending — filled at merge". Both are owned elsewhere — `.claude/workflow.json`'s
# feedbackLog for the path, docs/review-feedback.md's `## Entry format` for the
# literal — so both are ledgered there (architecture.md rule 9), and this comment
# is the pointer back. The two fail in OPPOSITE directions if they move without
# this file, and the difference is the whole reason the ledgers matter:
#
#   - the PATH moving is loud and closed. The awk target finds nothing under the
#     old name, the added-lines set comes back empty, and the step refuses with a
#     message naming the stale path. `is_human` is computed from merge.humanAlways
#     independently, so the refusal still fires on exactly the PRs it should.
#   - the LITERAL moving is a QUIET PASS. The field lines are `- **Category**:`
#     and `- **Verdict**:`, a different string, so they go on matching; only the
#     placeholder test below stops matching, and a gate that stops matching is a
#     gate that opens. Nothing anywhere says so — which is why this file is on
#     the Carriers bullet of the placeholder ledger in docs/review-feedback.md, and
#     why that ledger is the only thing standing between a reworded placeholder and
#     a humanAlways PR merged with no verdict.

feedback_state() { # -> 0 entry present and filled; 1 refuse (reason on stdout); 2 unreadable
  local diff rc spool added
  diff=$(gh_call pr diff "$pr_number" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'gh pr diff exited %s: %s\n' "$rc" "$diff"
    return 2
  fi
  spool=$(mktemp "${TMPDIR:-/tmp}/merge-pr.XXXXXX") || return 2
  printf '%s\n' "$diff" >"$spool"
  # Hunk tracking is what keeps this honest. `+++ b/<path>` is a file header
  # before the first `@@` and an ORDINARY ADDED LINE after it — a diff that adds
  # a line whose text begins `++ ` is spelled exactly that way — so the header
  # rule is guarded on not being inside a hunk rather than on the prefix alone.
  added=$(awk '
    /^diff --git /{ f = ""; hunk = 0; next }
    !hunk && /^\+\+\+ /{ p = $2; sub(/^b\//, "", p); f = p; next }
    !hunk && /^--- /{ next }
    /^@@/{ hunk = 1; next }
    /^\+/{ if (f == target) print substr($0, 2) }
  ' target='docs/review-feedback.md' "$spool")
  rm -f "$spool"

  if [ -z "$added" ]; then
    printf 'the branch adds no lines to docs/review-feedback.md — a humanAlways PR owes an entry there before the label ever goes on\n'
    return 1
  fi
  if ! printf '%s\n' "$added" | grep -q '^## '; then
    printf 'the branch touches docs/review-feedback.md but adds no "## " entry heading\n'
    return 1
  fi

  local fields
  fields=$(printf '%s\n' "$added" | grep -E '^- \*\*(Category|Verdict)\*\*:')
  if ! printf '%s\n' "$fields" | grep -q 'Category'; then
    printf 'the added entry has no "- **Category**:" line — an entry that cannot carry a category cannot record a decision\n'
    return 1
  fi
  if ! printf '%s\n' "$fields" | grep -q 'Verdict'; then
    printf 'the added entry has no "- **Verdict**:" line — the verdict is what the merge is waiting on\n'
    return 1
  fi
  if printf '%s\n' "$fields" | grep -qF 'pending — filled at merge'; then
    printf 'the entry Category or Verdict still reads the literal "pending — filled at merge". A verdict is a human-approved decision and this script will never write one: fill BOTH on the branch, push, then re-run\n'
    return 1
  fi
  return 0
}

if [ "$is_human" = "0" ]; then
  step 'feedback' 'not owed (no humanAlways path in the diff)'
else
  fb_reason=$(feedback_state)
  fb_rc=$?
  case "$fb_rc" in
    0) step 'feedback' 'entry on the branch, both placeholders filled' ;;
    2) fail 'feedback' "$fb_reason" ;;
    *)
      if [ "$already_merged" = "1" ]; then
        # Nothing left to refuse — the merge has happened. Reported rather than
        # enforced, and the run still ends non-zero so the gap is not silent.
        step 'feedback' 'UNFILLED on an already-merged PR (reported below)'
        defer 'feedback' "$fb_reason"
      else
        fail 'feedback' "$fb_reason"
      fi
      ;;
  esac
fi

# --- the append-only-log collision ---------------------------------------------------------------
#
# Lanes append entries to the tail of the logs below, so two lanes that both log
# something collide there and update-branch answers a conflict (cumulo#513 for
# docs/tech-debt.md; #60 for the other two). The one resolution that is arithmetic
# rather than judgement is automated: an entry-by-entry union, with everything
# else refused for the merge owner. Refusing wrongly costs one hand resolution;
# unioning wrongly is a mangled log the squash merge makes permanent.

# The logs this step may resolve, declared once: .claude/skills/review-loop/SKILL.md
# step 5 cites this name rather than listing them. Each path is an executable carrier
# of that log's name (the path ledgers: docs/tech-debt.md's header,
# .claude/ledgers/review-feedback-path.ledger and .claude/ledgers/friction-log-path.ledger),
# and a rename that misses this list fails closed: the conflict arrives under a path the
# list lacks, and the conflicted-set test refuses naming it.
APPEND_ONLY_LOGS=('docs/review-feedback.md' 'docs/tech-debt.md' 'docs/friction-log.md')

is_append_only_log() { # is_append_only_log <path> -> 0 when <path> is one of APPEND_ONLY_LOGS
  local p
  for p in "${APPEND_ONLY_LOGS[@]}"; do
    [ "$p" = "$1" ] && return 0
  done
  return 1
}

# log_union_plan <merge-base blob> <base-tip blob> <branch blob> <out-file> <scratch dir> <path>
#   -> 0 the union is written to <out-file>, a one-line summary on stdout
#      1 refused, the reason on stdout
#      2 the question could not be asked at all, the reason on stdout
#
# A three-way merge per entry, keyed by "## " heading, under the union rule
# .claude/skills/review-loop/SKILL.md step 5 owns. Fenced lines are not headings: every
# log's `Entry format` fence holds one. Cases: step 20 of merge-pr.test.sh.
log_union_plan() {
  node -e '
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const [oPath, aPath, bPath, outPath, scratch, target] = process.argv.slice(1);

const say = (code, msg) => {
  process.stdout.write(msg + "\n");
  process.exit(code);
};
const refuse = (msg) => say(1, target + ": " + msg);
const q = JSON.stringify;

let O, A, B;
try {
  O = fs.readFileSync(oPath, "utf8");
  A = fs.readFileSync(aPath, "utf8");
  B = fs.readFileSync(bPath, "utf8");
} catch (e) {
  say(2, "could not read the three " + target + " blobs: " + e.message);
}
if (O.length === 0) {
  refuse("the merge base has no copy of this file, so neither side is an append to a shared log");
}
for (const [text, side] of [[A, "base"], [B, "branch"]]) {
  if (text.length === 0) {
    refuse("the " + side + " side has no copy of this file — a log deleted or emptied on one side is not an append");
  }
}

// Trailing blank lines are dropped from every part, and the union rejoins the parts
// with one blank line, which is the shape prettier gives these files.
const trimTail = (lines) => {
  const out = lines.slice();
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
};

// -> { head, entries: [{ heading, text }] }
const parse = (text, copy) => {
  const lines = text.split("\n");
  const head = [];
  const entries = [];
  let current = head;
  let fence = null;
  for (const line of lines) {
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (run) {
      if (fence === null) fence = run[1];
      else if (run[1][0] === fence[0] && run[1].length >= fence.length && line.trim() === run[1]) fence = null;
    } else if (fence === null && line.startsWith("## ")) {
      current = [];
      entries.push({ heading: line, lines: current });
    }
    current.push(line);
  }
  if (fence !== null) {
    refuse("the " + copy + " copy ends inside an unclosed code fence, so its entry headings cannot be told from fenced text");
  }
  return { head: trimTail(head), entries: entries.map((e) => ({ heading: e.heading, text: trimTail(e.lines) })) };
};

const byHeading = (doc, copy) => {
  const map = new Map();
  for (const e of doc.entries) {
    if (map.has(e.heading)) {
      const n = doc.entries.filter((x) => x.heading === e.heading).length;
      refuse(
        "the " + copy + " copy holds " + n + " entries headed " + q(e.heading) +
          " — entries are matched by heading, and a heading repeated verbatim matches nothing"
      );
    }
    map.set(e.heading, e.text);
  }
  return map;
};

const o = parse(O, "merge-base");
const a = parse(A, "base");
const b = parse(B, "branch");
if (o.entries.length === 0) {
  refuse("the merge-base copy holds no \"## \" entry heading — this is not an append-only log this step knows how to union");
}
const oMap = byHeading(o, "merge-base");
const aMap = byHeading(a, "base");
const bMap = byHeading(b, "branch");
const oOrder = new Map(o.entries.map((e, i) => [e.heading, i]));

// A side keeps the base entries it holds in the base order, and every entry it adds
// comes after the last of them.
const mustOnlyAppend = (doc, side) => {
  let last = -1;
  let added = null;
  for (const e of doc.entries) {
    const at = oOrder.get(e.heading);
    if (at === undefined) {
      if (added === null) added = e.heading;
      continue;
    }
    if (added !== null) {
      refuse(
        "the " + side + " side adds the entry " + q(added) + " above " + q(e.heading) +
          ", which the merge base already had — this step unions entries appended at the tail, never inserted above one"
      );
    }
    if (at < last) {
      refuse(
        "the " + side + " side moves the entry " + q(e.heading) + " above " + q(o.entries[last].heading) +
          " — this step keeps the merge base order and never reorders it"
      );
    }
    last = at;
  }
};
mustOnlyAppend(a, "base");
mustOnlyAppend(b, "branch");

let slices = 0;
const slice = (text) => {
  const p = path.join(scratch, "slice-" + slices++);
  fs.writeFileSync(p, text === "" ? "" : text + "\n");
  return p;
};
// One side changed it: that side wins. Both did: git merge-file decides, and a
// conflict count back is the refusal while a failure to run is rc 2.
const merge3 = (what, mine, base, theirs) => {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  let merged;
  try {
    merged = execFileSync(
      "git",
      ["merge-file", "-p", "--quiet", slice(mine), slice(base), slice(theirs)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (e) {
    if (typeof e.status === "number" && e.status > 0 && e.status < 128) {
      refuse(what + " was changed on both sides and does not merge: git merge-file leaves " + e.status + " conflict(s) there");
    }
    say(2, "could not merge " + what + " in " + target + ": " + e.message);
  }
  return trimTail(merged.split("\n"));
};

const head = merge3("the header above the first entry", a.head, o.head, b.head);

const kept = [];
let deleted = 0;
let edited = 0;
for (const e of o.entries) {
  const h = e.heading;
  if (aMap.has(h) && bMap.has(h)) {
    const text = merge3("the entry " + q(h), aMap.get(h), e.text, bMap.get(h));
    if (text !== e.text) edited++;
    kept.push({ heading: h, text });
    continue;
  }
  for (const [map, keeper, deleter] of [[aMap, "base", "branch"], [bMap, "branch", "base"]]) {
    if (map.has(h) && map.get(h) !== e.text) {
      refuse(
        "the " + deleter + " side deletes the entry " + q(h) + ", which the " + keeper +
          " side edits — a deletion is authoritative only over an entry the other side left as it was"
      );
    }
  }
  deleted++;
}

const aNew = a.entries.filter((e) => !oMap.has(e.heading));
const bNew = b.entries.filter((e) => !oMap.has(e.heading));
for (const e of bNew) {
  if (aMap.has(e.heading)) {
    refuse("both sides add an entry headed " + q(e.heading) + " — this step unions distinct entries and never chooses between two versions of one");
  }
}

const entries = [...kept, ...aNew, ...bNew];
const union = [head, ...entries.map((e) => e.text)].filter((t) => t !== "").join("\n\n") + "\n";

// The heading-set arithmetic, from the three copies rather than from what was built:
// the merge base headings both sides still hold, then the additions of each side, base
// side first. A mismatch is this function wrong, not the logs.
const added = (doc) => doc.entries.map((e) => e.heading).filter((h) => !oMap.has(h));
const want = [
  ...o.entries.map((e) => e.heading).filter((h) => aMap.has(h) && bMap.has(h)),
  ...added(a),
  ...added(b),
];
const got = parse(union, "union").entries.map((e) => e.heading);
if (got.join("\n") !== want.join("\n")) {
  say(2, "the union of " + target + " does not come out as the merge base headings both sides kept plus both sides additions — refusing a result this step cannot account for");
}

try {
  fs.writeFileSync(outPath, union);
} catch (e) {
  say(2, "could not write the union: " + e.message);
}
const notes = [];
if (deleted > 0) notes.push(deleted + " deleted");
if (edited > 0) notes.push(edited + " edited in place");
if (head !== o.head) notes.push("the header above the first entry had moved and merged cleanly");
notes.push(got.length + " entr(ies) in all");
say(0, "base appended " + aNew.length + " entr(ies), the branch " + bNew.length + "; " + notes.join("; "));
' "$1" "$2" "$3" "$4" "$5" "$6"
}

union_reason=""
union_summary=""
union_new_sha=""
union_paths=""

union_abort() { # union_abort <worktree> <scratch dir> <reason> — undo and refuse
  git -C "$1" merge --abort >/dev/null 2>&1
  rm -rf "$2"
  union_reason="$3"
}

# log_union -> 0 resolved, committed and pushed; 1 refused with $union_reason set.
log_union() {
  local base_sha merge_base tip wt out rc dir conflicted status subject line past_oid
  local seen_paths summaries prettier_cmd p i
  seen_paths=()
  summaries=()
  past_oid=0
  union_reason=""
  union_summary=""
  union_paths=""

  [ -n "$pr_base_ref" ] || {
    union_reason="gh reported no base branch for this PR, so there is nothing to union against"
    return 1
  }

  # The base by its full ref, and its sha read once: a second rev-parse could answer
  # a different commit if another process fetches between the two.
  out=$(git -C "$repo_root" fetch --quiet origin "refs/heads/$pr_base_ref" 2>&1)
  rc=$?
  [ "$rc" -eq 0 ] || {
    union_reason="could not fetch the base branch '$pr_base_ref' (git fetch exited $rc): $out"
    return 1
  }
  base_sha=$(git -C "$repo_root" rev-parse FETCH_HEAD 2>&1) || {
    union_reason="could not resolve the fetched base branch '$pr_base_ref': $base_sha"
    return 1
  }

  # The lane's own worktree; creating one would make this step the owner of a
  # lifecycle it does not own.
  wt=$(worktree_holding "$repo_root" "$pr_head_ref") || {
    union_reason="git worktree list failed in $repo_root"
    return 1
  }
  [ -n "$wt" ] || {
    union_reason="no worktree holds '$pr_head_ref' — this resolution is committed on the branch, and there is nowhere to do that without checking it out somewhere it does not belong"
    return 1
  }
  wt=$(canon "$wt") || {
    union_reason="could not resolve the worktree path for '$pr_head_ref'"
    return 1
  }

  status=$(git -C "$wt" --no-optional-locks status --porcelain 2>&1)
  rc=$?
  [ "$rc" -eq 0 ] || {
    union_reason="could not read the status of $wt (git status exited $rc): $status"
    return 1
  }
  [ -z "$status" ] || {
    union_reason="the worktree at $wt is not clean — refusing to touch a tree holding somebody's uncommitted work: $(printf '%s' "$status" | tr '\n' '; ')"
    return 1
  }

  # What is on disk must be what GitHub is merging, or the lease below is a lease on
  # the wrong sha.
  tip=$(git -C "$wt" rev-parse HEAD 2>&1) || {
    union_reason="could not read HEAD in $wt: $tip"
    return 1
  }
  [ "$tip" = "$pr_head_sha" ] || {
    union_reason="the worktree at $wt is on $tip but the PR's head is $pr_head_sha — refusing to resolve a branch this checkout and GitHub do not agree about. If $tip is a resolution an earlier run committed and failed to push, push it by hand and re-run"
    return 1
  }

  # The conflicted set, merged in the object store without a checkout. rc 0 means
  # git merges these cleanly, so the conflict gh reported is not one visible here.
  conflicted=$(git -C "$repo_root" merge-tree --write-tree --name-only "$base_sha" "$tip" 2>&1)
  rc=$?
  case "$rc" in
    0)
      union_reason="git merge-tree merges '$pr_base_ref' into this branch cleanly, so the conflict gh reported is not one this step can see or resolve"
      return 1
      ;;
    1) ;;
    *)
      union_reason="git merge-tree exited $rc: $conflicted"
      return 1
      ;;
  esac

  # The tree oid, then one conflicted path per line, then a blank line, then
  # informational messages — only the middle section is the set.
  while IFS= read -r line; do
    if [ "$past_oid" = "0" ]; then
      past_oid=1
      continue
    fi
    [ -n "$line" ] || break
    seen_paths+=("$line")
  done <<EOF
$conflicted
EOF

  [ "${#seen_paths[@]}" -gt 0 ] || {
    union_reason="git merge-tree reported a conflict but named no conflicted path"
    return 1
  }
  for p in "${seen_paths[@]}"; do
    is_append_only_log "$p" || {
      union_reason="the conflicted set is$(printf ' %s' "${seen_paths[@]}") — this step resolves only the append-only logs (${APPEND_ONLY_LOGS[*]}), and $p is not one"
      return 1
    }
  done
  union_paths="${seen_paths[*]}"

  merge_base=$(git -C "$repo_root" merge-base "$base_sha" "$tip" 2>&1) || {
    union_reason="could not find the merge base of '$pr_base_ref' and '$pr_head_ref': $merge_base"
    return 1
  }

  dir=$(mktemp -d "${TMPDIR:-/tmp}/merge-pr-union.XXXXXX") || {
    union_reason="could not create a scratch directory for the union"
    return 1
  }
  i=0
  for p in "${seen_paths[@]}"; do
    mkdir "$dir/$i" || {
      rm -rf "$dir"
      union_reason="could not create a scratch directory for $p"
      return 1
    }
    # A path missing at a commit writes nothing, and the plan refuses any empty copy
    # by name.
    git -C "$repo_root" show "$merge_base:$p" >"$dir/$i/base" 2>/dev/null
    git -C "$repo_root" show "$base_sha:$p" >"$dir/$i/a" 2>/dev/null
    git -C "$repo_root" show "$tip:$p" >"$dir/$i/b" 2>/dev/null
    out=$(log_union_plan "$dir/$i/base" "$dir/$i/a" "$dir/$i/b" "$dir/$i/union" "$dir/$i" "$p")
    rc=$?
    if [ "$rc" -ne 0 ]; then
      union_reason="$out"
      rm -rf "$dir"
      return 1
    fi
    summaries+=("$p: $out")
    i=$((i + 1))
  done
  union_summary=$(printf '%s | ' "${summaries[@]}")
  union_summary=${union_summary% | }

  # Two checks hold the merge below to this analysis — a conflict where merge-tree
  # found one, and the same conflicted set — and only a tree that moved in between
  # fails them, which no fixture can arrange from outside the run. The seam, run here
  # with the worktree, is how merge-pr.test.sh's step 21 cases move it (#180).
  if [ -n "$MERGE_PR_UNION_SEAM" ]; then
    out=$("$MERGE_PR_UNION_SEAM" "$wt" 2>&1)
    rc=$?
    if [ "$rc" -ne 0 ]; then
      rm -rf "$dir"
      union_reason="MERGE_PR_UNION_SEAM exited $rc: $out"
      return 1
    fi
  fi

  # ---- from here on the worktree is being written to; every failure runs union_abort.

  # --no-ff: the merge commit `gh pr update-branch` would have written itself.
  out=$(git -C "$wt" -c core.commentChar=';' merge --no-ff --no-commit "$base_sha" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    union_abort "$wt" "$dir" "git merge of '$pr_base_ref' into '$pr_head_ref' reported no conflict, which contradicts what merge-tree just said — refusing rather than committing a merge nobody analysed"
    return 1
  fi

  conflicted=$(git -C "$wt" diff --name-only --diff-filter=U 2>&1)
  if [ "$(printf '%s\n' "$conflicted" | sort)" != "$(printf '%s\n' "${seen_paths[@]}" | sort)" ]; then
    union_abort "$wt" "$dir" "the merge left $(printf '%s\n' "$conflicted" | tr '\n' ' ')unresolved, not the analysed $union_paths — the tree moved under the analysis"
    return 1
  fi

  i=0
  for p in "${seen_paths[@]}"; do
    cat "$dir/$i/union" >"$wt/$p" || {
      union_abort "$wt" "$dir" "could not write the union into $wt/$p"
      return 1
    }
    i=$((i + 1))
  done

  # format:check is part of `pnpm verify`. An array, so the knob can carry arguments.
  read -r -a prettier_cmd <<<"$MERGE_PR_PRETTIER_CMD"
  out=$( (cd "$wt" && "${prettier_cmd[@]}" --write "${seen_paths[@]}") 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    union_abort "$wt" "$dir" "prettier exited $rc over $union_paths: $out"
    return 1
  fi

  # .claude/skills/review-loop/SKILL.md step 5's marker sweep, both spellings, after
  # the formatter: a marker here means the resolution is not what the plan computed.
  for p in "${seen_paths[@]}"; do
    if grep -nE '^(<<<<<<<|=======|>>>>>>>)' "$wt/$p" >/dev/null 2>&1; then
      union_abort "$wt" "$dir" "the resolved $p still holds conflict markers — refusing to commit it"
      return 1
    fi
  done

  out=$(git -C "$wt" add -- "${seen_paths[@]}" 2>&1) || {
    union_abort "$wt" "$dir" "could not stage the resolved $union_paths: $out"
    return 1
  }

  out=$(git -C "$wt" diff HEAD --check 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    union_abort "$wt" "$dir" "git diff HEAD --check rejected the resolution: $out"
    return 1
  fi

  # commit.cleanup=strip makes the message independent of repo-local config, and
  # core.commentChar=';' must travel with it or strip deletes the '#<issue>:' subject
  # (.claude/skills/review-loop/SKILL.md step 5). The pre-commit hook runs, over the
  # whole mid-merge index; it fails toward union_abort, and --no-verify would skip the
  # secret scan on content this commit brings in. The prefix is conditional because a
  # PR merged under an explicit --method may have no Closes line, and an empty array
  # indexed under `set -u` aborts the run mid-merge.
  subject="${union_paths// /, } — union with '$pr_base_ref' (both sides' entries kept)"
  [ "${#pr_closes[@]}" -gt 0 ] && subject="#${pr_closes[0]}: $subject"
  out=$(git -C "$wt" -c core.commentChar=';' -c commit.cleanup=strip commit -m "$subject" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    union_abort "$wt" "$dir" "could not commit the resolution (git commit exited $rc): $out"
    return 1
  fi

  # A lease on GitHub's own headRefOid: the push is a fast-forward, and the lease is
  # what makes it refuse if the remote moved while the analysis ran.
  out=$(git -C "$wt" push --force-with-lease="$pr_head_ref:$pr_head_sha" \
    origin "HEAD:refs/heads/$pr_head_ref" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    # Not aborted — the merge is committed. The tip guard above refuses a bare re-run,
    # so the message says how to repair it.
    rm -rf "$dir"
    union_reason="the resolution is committed on '$pr_head_ref' but the push failed (git push exited $rc). A re-run will NOT retry it — push $wt by hand, then re-run: $out"
    return 1
  fi

  # update_branch_step needs the sha this put on the branch: a retried update-branch
  # that writes has replaced this head, not the classify-time one.
  union_new_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null)

  rm -rf "$dir"
  return 0
}

# --- step: update-branch -----------------------------------------------------------------------
#
# FIRST, per .claude/skills/review-loop/SKILL.md step 5: a green watch on a stale
# head is not a mergeable state, and the bounce costs a whole second CI round to
# discover (cumulo#229, cumulo#241). "Unconditional" in that sentence means "never skipped
# because a watch looked green" — it is NOT unconditional across merge methods.
#
# A --rebase batch never runs it. `gh pr update-branch` writes a MERGE COMMIT, and
# .claude/skills/run-issue/SKILL.md step 4 says why that is fatal there: a merge
# commit breaks the one-commit-per-member invariant and blocks rebase-merge
# outright, so a batch that is BEHIND or conflicted gets a "curate onto latest
# main" bounce to the branch's owner instead (the same rule is carried by
# .claude/agents/task-orchestrator.md's bounce paragraphs and mirrored in
# docs/design/task-orchestrator.md). Running it anyway would pollute the branch
# first and only then refuse at the merge step — a refusal that costs exactly what
# it exists to prevent.

checks_baseline=0

# What the checks step needs from this one: the heads this run is replacing,
# whether they were replaced at all, and the answer that claimed so. GitHub goes on
# answering the old sha and the old rollup after the write lands (the checks step
# says why that matters), so "is this still one of the heads we superseded" is what
# separates the stale answer from the fresh one — and gh's own words are what tell
# a head that has not moved YET from one that was never going to.
#
# TWO shas, not one, and the plural is load-bearing. A run can supersede a head
# twice: the append-only-log union pushes over the head read at classify time, and a
# retried update-branch can then write over the union's own head. The gate is an
# inequality, so excluding only the LATEST superseded sha leaves the earlier one
# admissible — and the earlier one is exactly what a lagging GitHub answers. That
# is not hypothetical: it is what the first version of this fix did, and a probe
# case caught the run taking its merge on the pre-union head's rollup. Both are
# excluded, and superseded_union_sha stays empty on every run that did not union.
pre_update_sha=""
superseded_union_sha=""
await_new_head=0
update_answer=""

# The append-only-log union is attempted AT MOST ONCE per run. A second conflict after a
# resolution that reported success means either main moved again — which a re-run
# handles, and which this run has no budget to chase — or the step resolved something
# other than what update-branch was complaining about. Retrying either would spend
# attempts on a loop with no end, so the second conflict fails the run and the message
# says so.
union_attempted=0

update_branch_step() {
  local attempt=1 out lower rc
  while [ "$attempt" -le "$MERGE_PR_UPDATE_RETRIES" ]; do
    out=$(gh_call pr update-branch "$pr_number" 2>&1)
    rc=$?
    # A timed-out write is not retried, because whether it landed is unknown. If it
    # did, the retry answers "already up to date", which leaves the await gate
    # disarmed while GitHub is still answering the replaced head (cumulo#501).
    if [ "$rc" -eq 124 ]; then
      fail 'update-branch' "the call timed out, so whether it wrote is unknown — re-run: $out"
    fi
    # Matched against a lowercased copy rather than with `shopt -s nocasematch`:
    # that shell option is global, and a function that leaves it set changes how
    # every later `case` in the script matches.
    lower=$(printf '%s' "$out" | tr '[:upper:]' '[:lower:]')
    if [ "$rc" -eq 0 ]; then
      # gh reports the no-op case on the SUCCESS path ("PR branch already
      # up-to-date"), and the API has also been seen rejecting it as a 422. Both
      # spellings are read here, because which one you get is gh's business and
      # the distinction this step reports is updated-or-not.
      case "$lower" in
        *"already up to date"* | *"already up-to-date"* | *"not behind"*)
          step 'update-branch' 'already up to date with the base'
          ;;
        *)
          await_new_head=1
          update_answer=${out%%$'\n'*}
          # A write after a log union replaced the sha that resolution
          # pushed, so that sha joins the superseded set — ADDED to it, never swapped
          # for the classify-time head, which GitHub can still be answering.
          [ -n "$union_new_sha" ] && superseded_union_sha="$union_new_sha"
          step 'update-branch' "updated onto the base (attempt $attempt)"
          ;;
      esac
      return 0
    fi
    case "$lower" in
      *"already up to date"* | *"already up-to-date"* | *"not behind"*)
        step 'update-branch' 'already up to date with the base'
        return 0
        ;;
      # The conflicted update. GitHub answers this 422 when the base and the head have
      # both changed the same region, and by far the commonest instance here is the one
      # cumulo#513 and #60 are about: two lanes that both appended an entry to one of
      # APPEND_ONLY_LOGS.
      #
      # Matching on the bare word is broad on purpose, in the only direction it can be
      # safely broad: every arm here leads either to the union step — which makes its
      # own decision from scratch, against git rather than against this message, and
      # refuses everything it is not certain of — or to the `*)` arm, which fails the
      # run. A spelling matched wrongly costs one merge-tree call and a refusal; a
      # spelling NOT matched falls through to `*)` and fails, which is where this was
      # before the step existed.
      *"conflict"* | *"not mergeable"*)
        if [ "$union_attempted" = "1" ]; then
          fail 'update-branch' "gh reports a conflict again after the $union_paths union this run already pushed. Either the base moved under it, in which case re-run, or the conflict was never the one that step resolves — gh said: $out"
        fi
        union_attempted=1
        step 'update-branch' "gh reports a conflict; asking whether it is an append-only-log collision"
        if ! log_union; then
          fail 'update-branch' "the conflict is not one this script may resolve: $union_reason"
        fi
        # The head has moved, and the gate that makes the checks step wait for it is
        # armed HERE rather than left to the next attempt. Without this, the retry below
        # answers "already up to date" — correctly, the branch now contains the base —
        # and every read after it is evaluated against whatever head GitHub is still
        # caching, which is cumulo#501's defect reached through a different door.
        await_new_head=1
        pre_update_sha="$pr_head_sha"
        update_answer="merge-pr unioned $union_paths on the branch and pushed it"
        step 'update-branch' "$union_paths unioned and pushed ($union_summary); re-running update-branch"
        # No attempt is consumed. The attempt budget bounds the head-sha race; this arm
        # is bounded by union_attempted, which allows exactly one pass through it. Taking
        # an attempt here would make MERGE_PR_UPDATE_RETRIES=1 fall out of the loop with
        # "gave up after 1 attempts" AFTER a resolution it had successfully pushed.
        #
        # The wait is the same one the head-sha arm takes, for the same reason: gh has
        # just been told about a push and answers the mergeability it computed before
        # it. An update-branch issued in the same second can come back 422 on the state
        # it is replacing, and union_attempted would turn that into a hard failure
        # rather than a retry — losing the one-invocation property this step exists for.
        # The harness pins the interval to 0, so no case waits.
        sleep "$MERGE_PR_RETRY_SECONDS"
        ;;
      # The head-sha race, in every spelling it is known to arrive in. The REST
      # endpoint's documented 422 is `expected_head_sha didn't match pull request
      # head.` — UNDERSCORES, which is why `head sha` with a space never matched
      # it and an arm written only that way would have failed the run on the
      # exact race this loop exists for. gh also drives the same update through
      # the GraphQL `updatePullRequestBranch` mutation, whose argument is
      # `expectedHeadOid`, so that vocabulary is matched too. An unmatched
      # spelling still falls to the `*)` arm and fails the run, which is the safe
      # direction: a re-run is the repair.
      *"expected_head_sha"* | *"head_sha"* | *"head sha"* | *"head oid"* | \
        *"expectedheadoid"* | *"expected head"* | *"out of date"* | *"stale"*)
        if [ "$attempt" -ge "$MERGE_PR_UPDATE_RETRIES" ]; then
          fail 'update-branch' "the head moved under every one of $MERGE_PR_UPDATE_RETRIES attempts: $out"
        fi
        sleep "$MERGE_PR_RETRY_SECONDS"
        attempt=$((attempt + 1))
        ;;
      *)
        fail 'update-branch' "gh pr update-branch exited $rc: $out"
        ;;
    esac
  done
  fail 'update-branch' "gave up after $MERGE_PR_UPDATE_RETRIES attempts"
}

if [ "$already_merged" = "1" ]; then
  step 'update-branch' 'skipped (PR is already MERGED)'
elif [ "$merge_method" = "--rebase" ]; then
  checks_baseline=${#check_names[@]}
  step 'update-branch' 'skipped — a --rebase batch is curated and force-pushed by its owner, never updated from here (a merge commit would block rebase-merge)'
else
  # The count of checks on the PRE-update head is the floor the post-update head
  # must reach. After an update-branch the rollup is briefly empty or short while
  # the new head's workflows register, and "no check is pending" is trivially true
  # of a rollup with no checks in it yet; the floor is what makes the poll wait for
  # the ones that have not arrived. Derived from this PR rather than from the base
  # branch, because the base branch's workflow set is not this PR's.
  #
  # What the floor does NOT deliver, stated so nobody trusts it for more: it is a
  # floor, not a required-checks list. A head whose PREVIOUS read also had no
  # checks — a PR polled for the first time seconds after its push — yields a floor
  # of 1, so one green check would clear the poll. What stops a merge there is
  # branch protection, which this script deliberately does not restate: the merge
  # runs only from mergeStateStatus CLEAN, and a head missing a required check is
  # BLOCKED, not CLEAN. MERGE_PR_EXPECTED_CHECKS raises the floor for an operator
  # who wants the poll itself to wait rather than the merge step to refuse.
  checks_baseline=${#check_names[@]}
  pre_update_sha="$pr_head_sha"
  update_branch_step
fi

# --- step: checks -------------------------------------------------------------------------------
#
# An update-branch that wrote is not visible at once: for the window
# .claude/skills/review-loop/SKILL.md step 5 names — it names the same trap for the
# hand-typed chain — `gh pr view` still answers the PREVIOUS head's sha, that
# head's rollup, and BLOCKED, and every verdict this step and the merge step take
# reads one of those three. On cumulo#501 the answer was the old head's checks,
# complete and none pending, so the baseline floor was satisfied by a rollup
# belonging to a commit that no longer existed, and the merge step then refused on
# the BLOCKED that came with it. A re-run 90 s later merged. The floor cannot catch
# this on its own: the stale rollup has the same count as the head it came from.
#
# So nothing is evaluated until every sha this run superseded is gone — which shas
# those are is the update-branch step's business, stated where pre_update_sha and
# superseded_union_sha are declared, and deliberately not re-argued here. Bounded by
# the same poll budget the checks themselves get. A head that never moves is REFUSED
# rather than merged on: the alternative reading — clear the gate on a CLEAN
# unmoved read, since the stale answer is BLOCKED — turns one observation into a
# gate, and gets a merge taken on a head whose checks nobody looked at when it is
# wrong. The refusal costs a re-run, which is the direction this script is wrong in
# everywhere else, and it quotes gh's answer because the OTHER cause of an unmoved
# head is a no-op spelling the arm above does not know.

check_is_pending() { # check_is_pending <index> -> 0 when that check has not settled
  # A COMPLETED check with no conclusion has not settled, and counting it as
  # passing is the one direction this poll must never be wrong in.
  [ "${check_statuses[$1]}" = "COMPLETED" ] && [ -n "${check_conclusions[$1]}" ] && return 1
  return 0
}

checks_verdict() { # -> ready:<n> | pending:<present>:<expected>:<pending> | failed:<name>:<conclusion>
  local expected i total pending
  expected="$checks_baseline"
  [ "$MERGE_PR_EXPECTED_CHECKS" -gt "$expected" ] && expected="$MERGE_PR_EXPECTED_CHECKS"
  [ "$expected" -lt 1 ] && expected=1
  total=${#check_names[@]}
  pending=0
  for ((i = 0; i < total; i++)); do
    case "${check_conclusions[$i]}" in
      FAILURE | TIMED_OUT | CANCELLED | STARTUP_FAILURE | ACTION_REQUIRED | ERROR)
        printf 'failed:%s:%s\n' "${check_names[$i]}" "${check_conclusions[$i]}"
        return 0
        ;;
    esac
    check_is_pending "$i" && pending=$((pending + 1))
  done
  if [ "$total" -ge "$expected" ] && [ "$pending" -eq 0 ]; then
    printf 'ready:%s\n' "$total"
    return 0
  fi
  printf 'pending:%s:%s:%s\n' "$total" "$expected" "$pending"
}

# One stderr line per poll read, whatever it found, so that a stuck poll leaves a
# record of which wait it was in (issue #55).
poll_log() { # poll_log <message>
  printf 'merge-pr: checks poll %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&2
}

poll_log_read() { # poll_log_read <verdict> — the state one successful read left behind
  local i waiting=""
  for ((i = 0; i < ${#check_names[@]}; i++)); do
    check_is_pending "$i" && waiting="$waiting ${check_names[$i]}=${check_statuses[$i]:-(none)}"
  done
  poll_log "head=$pr_head_sha await_new_head=$await_new_head merge_state=$pr_merge_state verdict=$1 waiting_on=[${waiting# }]"
}

if [ "$already_merged" = "1" ]; then
  step 'checks' 'skipped (PR is already MERGED)'
else
  poll_deadline=$((SECONDS + MERGE_PR_POLL_TIMEOUT_SECONDS))
  verdict=""
  poll_read_failures=0
  while :; do
    # A failed read is retried, not fatal on the first one: with every gh call
    # time-boxed, a hung request now arrives here as a failure, and a single
    # dropped request should not cost the run.
    if ! read_pr; then
      poll_read_failures=$((poll_read_failures + 1))
      poll_log "read failed ($poll_read_failures of $MERGE_PR_READ_RETRIES attempts): $last_error"
      [ "$poll_read_failures" -lt "$MERGE_PR_READ_RETRIES" ] ||
        fail 'checks' "$poll_read_failures consecutive reads failed; the last: $last_error"
      sleep "$MERGE_PR_POLL_INTERVAL_SECONDS"
      continue
    fi
    poll_read_failures=0
    if [ "$pr_state" = "MERGED" ]; then
      # Somebody merged it while we polled. Not an error — the post-merge steps
      # below are exactly what is still owed.
      already_merged=1
      step 'checks' 'PR was merged elsewhere during the poll'
      break
    fi
    if [ "$await_new_head" = "1" ] && [ "$pr_head_sha" != "$pre_update_sha" ] &&
      { [ -z "$superseded_union_sha" ] || [ "$pr_head_sha" != "$superseded_union_sha" ]; }; then
      await_new_head=0
      step 'checks' "the update moved the head ${pre_update_sha}${superseded_union_sha:+/$superseded_union_sha} -> $pr_head_sha; reading that head"
    fi
    verdict=$(checks_verdict)
    poll_log_read "$verdict"
    if [ "$await_new_head" = "0" ]; then
      case "$verdict" in
        ready:*)
          step 'checks' "${verdict#ready:} check(s) complete on $pr_head_sha, none pending, none failing"
          break
          ;;
        failed:*)
          rest=${verdict#failed:}
          fail 'checks' "check '${rest%:*}' concluded ${rest##*:}"
          ;;
      esac
    fi
    if [ "$SECONDS" -ge "$poll_deadline" ]; then
      [ "$await_new_head" = "0" ] || fail 'checks' \
        "timed out after ${MERGE_PR_POLL_TIMEOUT_SECONDS}s — gh answered \"$update_answer\", which this step read as a write, but the head still reads $pr_head_sha, one of the sha(s) this run superseded (${pre_update_sha}${superseded_union_sha:+, $superseded_union_sha}), so every check and merge state here is a replaced head's. Either the update has not landed yet (re-run), or that answer is a no-op spelling update-branch does not recognise, in which case the branch is already current and the spelling belongs in that step's no-op arm"
      rest=${verdict#pending:}
      present=${rest%%:*}
      rest=${rest#*:}
      fail 'checks' "timed out after ${MERGE_PR_POLL_TIMEOUT_SECONDS}s — ${present} of an expected ${rest%%:*} check(s) present, ${rest##*:} still pending"
    fi
    sleep "$MERGE_PR_POLL_INTERVAL_SECONDS"
  done
fi

# --- step: merge ---------------------------------------------------------------------------------

if [ "$already_merged" = "1" ]; then
  step 'merge' 'skipped (PR is already MERGED)'
else
  # The curated-history check ran at classify time; re-running it here would read
  # the same commits. What is re-read is the merge state, which the poll may have
  # moved.
  #
  # mergeStateStatus is eventually consistent: GitHub answers UNKNOWN while it is
  # still computing the merge, so that one state is re-read rather than refused —
  # MERGE_PR_CONFIRM_RETRIES reads in all, the poll's last read being the first.
  # The MERGED arm leaves the loop early rather than deciding anything — a merged
  # PR also answers UNKNOWN, so without it a PR merged elsewhere during this
  # window sleeps out every remaining retry before the block below reaches the
  # same verdict. Time, not correctness: the guard on that block is what decides.
  attempt=1
  while [ "$pr_merge_state" = "UNKNOWN" ] && [ "$pr_state" != "MERGED" ] &&
    [ "$attempt" -lt "$MERGE_PR_CONFIRM_RETRIES" ]; do
    sleep "$MERGE_PR_RETRY_SECONDS"
    read_pr || fail 'merge' "$last_error"
    attempt=$((attempt + 1))
  done
fi

if [ "$already_merged" = "0" ] && [ "$pr_state" = "MERGED" ]; then
  already_merged=1
  step 'merge' 'skipped (the PR was merged elsewhere while this run was working)'
elif [ "$already_merged" = "0" ]; then
  # The bounce is prescribed only for the two states it is the repair for. The
  # rule is scoped that way at both its carriers — run-issue step 4 and
  # docs/design/task-orchestrator.md both say "a batch that is BEHIND or
  # conflicted" — and the scoping is load-bearing rather than pedantic: BLOCKED
  # (branch protection), UNKNOWN (GitHub still computing) and DRAFT all reach this
  # point too. The residual, so nobody rediscovers it as a bug: a batch that is
  # BOTH stale and blocked reports BLOCKED, so it falls through to the generic
  # refusal and is told its state with no repair named. It is never merged; the
  # merge owner reads the state and finds the second blocker. Prescribing a
  # force-push bounce for BLOCKED was the worse of the two errors. And telling a
  # merge owner to bounce an agent into a
  # rebase-and-force-push when the blocker is a required review is walking them
  # into a wrong and expensive repair. Everything else falls to the generic
  # refusal below, which names the state and prescribes nothing.
  if [ "$merge_method" = "--rebase" ]; then
    case "$pr_merge_state" in
      BEHIND | DIRTY)
        fail 'merge' "mergeStateStatus is '$pr_merge_state' and this is a --rebase batch: the repair is a \"curate onto latest main\" bounce to the branch's owner, force-pushed, never an update from here — gh pr update-branch would write a merge commit and block the rebase-merge outright"
        ;;
    esac
  fi
  [ "$pr_merge_state" = "CLEAN" ] || fail 'merge' "mergeStateStatus is '$pr_merge_state', not CLEAN — a merge is only ever taken from CLEAN"

  merge_out=$(gh_call pr merge "$pr_number" "$merge_method" 2>&1)
  merge_rc=$?
  [ "$merge_rc" -eq 0 ] || fail 'merge' "gh pr merge $merge_method exited $merge_rc: $merge_out"

  # Merged is not what gh's exit code says; it is what the PR says.
  attempt=1
  while :; do
    read_pr || fail 'merge' "merged with rc=0 but the state could not be confirmed: $last_error"
    [ "$pr_state" = "MERGED" ] && break
    if [ "$attempt" -ge "$MERGE_PR_CONFIRM_RETRIES" ]; then
      fail 'merge' "gh pr merge exited 0 but the PR is still '$pr_state' after $MERGE_PR_CONFIRM_RETRIES reads"
    fi
    attempt=$((attempt + 1))
    sleep "$MERGE_PR_RETRY_SECONDS"
  done
  already_merged=1
  step 'merge' "merged ${merge_method#--} (rc=$merge_rc), state MERGED"
fi

# --- step: label ------------------------------------------------------------------------------
#
# Everything below this line is gated on state == MERGED, which the block above
# either confirmed or short-circuited into. cumulo#469 took the label off on
# CI-green; this step living after the merge is the whole of that repair.

[ "$pr_state" = "MERGED" ] || fail 'label' "refusing the post-merge steps: the PR is '$pr_state', not MERGED"

has_awaiting=0
for label in ${pr_labels[@]+"${pr_labels[@]}"}; do
  [ "$label" = "awaiting-review" ] && has_awaiting=1
done

if [ "$has_awaiting" = "0" ]; then
  step 'label' "'awaiting-review' not present — nothing to remove"
else
  label_out=$(gh_call pr edit "$pr_number" --remove-label awaiting-review 2>&1)
  label_rc=$?
  [ "$label_rc" -eq 0 ] || fail 'label' "gh pr edit --remove-label exited $label_rc: $label_out"
  step 'label' "'awaiting-review' removed, after the merge"
fi

# --- step: issues -----------------------------------------------------------------------------

if [ "${#pr_closes[@]}" -eq 0 ]; then
  step 'issues' "$merge_reason — nothing to verify"
else
  open_issues=""
  read_failures=""
  for n in "${pr_closes[@]}"; do
    attempt=1
    while :; do
      issue_json=$(gh_call issue view "$n" --json number,state 2>&1)
      issue_rc=$?
      if [ "$issue_rc" -ne 0 ]; then
        read_failures="$read_failures #$n"
        break
      fi
      issue_state=$(printf '%s' "$issue_json" | json_field state)
      [ "$issue_state" = "CLOSED" ] && break
      if [ "$attempt" -ge "$MERGE_PR_CONFIRM_RETRIES" ]; then
        open_issues="$open_issues #$n"
        break
      fi
      attempt=$((attempt + 1))
      sleep "$MERGE_PR_RETRY_SECONDS"
    done
  done
  if [ -n "$read_failures" ]; then
    fail 'issues' "could not read issue(s)${read_failures} — the merge stands; re-run to finish the chain"
  fi
  if [ -n "$open_issues" ]; then
    step 'issues' "still OPEN:${open_issues} (reported below)"
    defer 'issues' "the merge did not close${open_issues} — check the Closes spelling in the PR body, then close them by hand"
  else
    step 'issues' "closed by the merge:$(printf ' #%s' "${pr_closes[@]}")"
  fi
fi

# --- step: worktree ----------------------------------------------------------------------------
#
# Delegated to reap-worktree.sh, which already owns every safety check worth
# having — own-cwd, locked, detached, dirty, min-age, live-session, merge-state —
# and answers KEPT with a reason rather than guessing. The caller's cwd is checked
# here as well, and reap is run FROM that cwd so its own guard sees the same
# truth: a guard that depends on this script not having cd'd is a guard that one
# refactor removes.

wt=$(worktree_holding "$repo_root" "$pr_head_ref") || fail 'worktree' "git worktree list failed in $repo_root"

if [ -z "$wt" ]; then
  step 'worktree' "none holds '$pr_head_ref'"
else
  wt=$(canon "$wt") || fail 'worktree' "could not resolve $wt"
  case "$caller_cwd" in
    "$wt" | "$wt"/*)
      step 'worktree' "$wt is the caller's own working directory — not reaped"
      ;;
    *)
      reap_out=$( (cd "$caller_cwd" && bash "$MERGE_PR_REAP_CMD" "$wt") 2>&1)
      reap_rc=$?
      reap_line=${reap_out%%$'\n'*}
      case "$reap_rc" in
        0) step 'worktree' "${reap_line:-reaped $wt}" ;;
        1) step 'worktree' "${reap_line:-kept $wt}" ;;
        *)
          step 'worktree' "reap-worktree.sh exited $reap_rc (reported below)"
          defer 'worktree' "reap-worktree.sh reached no verdict on $wt: ${reap_line:-no output}"
          ;;
      esac
      ;;
  esac
fi

# --- verdict ------------------------------------------------------------------------------------

if [ "${#deferred[@]}" -gt 0 ]; then
  printf 'merge-pr: PR #%s is merged, but the chain did not finish clean:\n' "$pr_number" >&2
  for d in "${deferred[@]}"; do
    printf '  - %s\n' "$d" >&2
  done
  exit 1
fi

step 'done' "PR #$pr_number MERGED — $pr_url"
