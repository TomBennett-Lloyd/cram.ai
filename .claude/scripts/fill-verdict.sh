#!/usr/bin/env bash
#
# The branch half of the humanAlways merge ritual, once the owner has decided: fill the PR's
# docs/review-feedback.md entry (Category and Verdict — both placeholders, never one), flip every
# ADR the PR adds or modifies from `proposed` to `accepted`, run `pnpm verify`, commit, push.
# merge-pr.sh refuses an unfilled entry and never fills one (its header says why); this script
# is the fill, and it writes only what the caller passes — the verdict is the caller's.
#
# Every refusal is taken before anything is written, and a failure after the write (verify, the
# commit) restores the tree, so the repair for any non-zero exit is to fix the cause and re-run.
#
# Usage:
#   fill-verdict.sh <pr> --category <category> --verdict "<text>"
#                   [--worktree <path>] [--no-push] [repo-root]
#
#     category    one the feedback log's `## Category vocabulary` declares, optionally followed
#                 by a parenthesised qualifier, as that section permits
#     --worktree  the PR branch's worktree (default: the worktree of repo-root holding the branch)
#     --no-push   commit, but leave the push to the caller
#     repo-root   the repository to act in (default: the one holding this script)
#
# Exit:  0 filled, committed (and pushed)
#        1 refused or failed — the message names the step; nothing is left half-done
#        2 no verdict at all (usage, no node, no repo)
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./worktree-lib.sh
. "$script_dir/worktree-lib.sh"

: "${FILL_VERDICT_GH_CMD:=gh}"                  # GitHub CLI; the seam the harness stubs
: "${FILL_VERDICT_VERIFY_CMD:=pnpm verify}"     # the pre-commit gate, run in the worktree

# The placeholder docs/review-feedback.md's `## Entry format` owns; this file is a carrier on that
# file's ledger. If the literal moves without this line, no entry matches and every run refuses.
PLACEHOLDER='pending — filled at merge'

usage() {
  cat >&2 <<'EOF'
usage: fill-verdict.sh <pr> --category <category> --verdict "<text>"
                       [--worktree <path>] [--no-push] [repo-root]

Exit: 0 filled and committed, 1 refused or failed (a re-run resumes), 2 no verdict.
EOF
  exit 2
}

step() { printf 'fill-verdict: %s — %s\n' "$1" "$2"; }
fail() {
  printf 'fill-verdict: %s — FAILED: %s\n' "$1" "$2" >&2
  exit 1
}

pr_number="" category="" verdict="" worktree="" repo_root="" push=1
have_category=0 have_verdict=0
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help) usage ;;
    --category)
      [ $# -ge 2 ] || usage
      category="$2" have_category=1
      shift
      ;;
    --verdict)
      [ $# -ge 2 ] || usage
      verdict="$2" have_verdict=1
      shift
      ;;
    --worktree)
      [ $# -ge 2 ] || usage
      worktree="$2"
      shift
      ;;
    --no-push) push=0 ;;
    -*)
      printf 'fill-verdict: unknown option %s\n' "$1" >&2
      usage
      ;;
    *)
      if [ -z "$pr_number" ]; then
        pr_number="$1"
      elif [ -z "$repo_root" ]; then
        repo_root="$1"
      else
        printf 'fill-verdict: unexpected argument %s\n' "$1" >&2
        usage
      fi
      ;;
  esac
  shift
done

case "$pr_number" in '' | *[!0-9]*) usage ;; esac
[ "$have_category" = 1 ] && [ "$have_verdict" = 1 ] || usage
case "$category$verdict" in *$'\n'* | *$'\r'*)
  printf 'fill-verdict: --category and --verdict are single field lines; neither may hold a newline\n' >&2
  exit 2
  ;;
esac
[ -n "$verdict" ] && [ "$verdict" != "$PLACEHOLDER" ] || {
  printf 'fill-verdict: --verdict must state the decision; it cannot be empty or the placeholder\n' >&2
  exit 2
}

if [ -z "$repo_root" ]; then
  repo_root=$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null) || exit 2
fi
[ -d "$repo_root" ] || exit 2
repo_root=$(canon "$repo_root") || exit 2
cd "$repo_root" || exit 2

# --- step: pr -------------------------------------------------------------------------------

pr_json=$("$FILL_VERDICT_GH_CMD" pr view "$pr_number" --json state,headRefName,headRefOid,baseRefName,body 2>&1) ||
  fail 'pr' "gh pr view $pr_number failed: $pr_json"

# TAB-separated `key value` records; the Closes keywords are the ones merge-pr.sh's pr_facts reads.
facts=$(printf '%s' "$pr_json" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  let pr;
  try {
    pr = JSON.parse(raw);
  } catch (e) {
    process.stderr.write("gh returned output that is not JSON: " + e.message + "\n");
    process.exit(2);
  }
  const put = (k, v) => console.log(k + "\t" + String(v == null ? "" : v).replace(/[\t\r\n]/g, " "));
  for (const k of ["state", "headRefName", "headRefOid", "baseRefName"]) put(k, pr[k]);
  const seen = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  let m;
  while ((m = re.exec(pr.body || ""))) {
    if (!seen.has(m[1])) put("closes", m[1]);
    seen.add(m[1]);
  }
});
' 2>&1) || fail 'pr' "$facts"

pr_state="" head_ref="" head_sha="" base_ref="" closes=()
while IFS=$'\t' read -r key value; do
  case "$key" in
    state) pr_state="$value" ;;
    headRefName) head_ref="$value" ;;
    headRefOid) head_sha="$value" ;;
    baseRefName) base_ref="$value" ;;
    closes) closes+=("$value") ;;
  esac
done <<EOF
$facts
EOF

[ "$pr_state" = "OPEN" ] || fail 'pr' "PR #$pr_number is '${pr_state:-unknown}', not OPEN — a verdict is filled before the merge"
[ -n "$head_ref" ] && [ -n "$head_sha" ] && [ -n "$base_ref" ] || fail 'pr' "gh's answer lacks the head or base of PR #$pr_number"

branch_number=""
case "$head_ref" in [0-9]*-*) branch_number=${head_ref%%-*} ;; esac
case "$branch_number" in *[!0-9]*) branch_number="" ;; esac

issue=""
if [ "${#closes[@]}" -eq 1 ]; then
  issue="${closes[0]}"
elif [ "${#closes[@]}" -eq 0 ]; then
  issue="$branch_number"
elif [ -n "$branch_number" ]; then
  for n in "${closes[@]}"; do [ "$n" = "$branch_number" ] && issue="$n"; done
fi
[ -n "$issue" ] || fail 'pr' "cannot tell which issue PR #$pr_number's entry belongs to: Closes [${closes[*]-}], head branch '$head_ref'"
step 'pr' "#$pr_number, issue #$issue, head $head_ref"

# --- step: worktree -------------------------------------------------------------------------

if [ -z "$worktree" ]; then
  worktree=$(worktree_holding "$repo_root" "$head_ref") || fail 'worktree' "git worktree list failed in $repo_root"
  [ -n "$worktree" ] || fail 'worktree' "no worktree of $repo_root holds '$head_ref' — pass --worktree"
fi
[ -d "$worktree" ] || fail 'worktree' "$worktree is not a directory"
wt=$(canon "$worktree") || fail 'worktree' "could not resolve $worktree"

on_branch=$(git -C "$wt" symbolic-ref --short -q HEAD 2>/dev/null)
[ "$on_branch" = "$head_ref" ] || fail 'worktree' "$wt is on '${on_branch:-a detached HEAD}', not the PR's head branch '$head_ref'"
is_clean "$wt" || fail 'worktree' "$wt is not clean — commit or stash first: $(git -C "$wt" status --porcelain | tr '\n' ';')"
tip=$(git -C "$wt" rev-parse HEAD 2>&1) || fail 'worktree' "could not read HEAD in $wt: $tip"
[ "$tip" = "$head_sha" ] || fail 'worktree' "$wt is at $tip but the PR's head is $head_sha — pull or push until they agree"
step 'worktree' "$wt clean at $tip"

# --- step: fill -----------------------------------------------------------------------------

out=$(git -C "$wt" fetch --quiet origin "$base_ref" 2>&1) || fail 'fill' "could not fetch '$base_ref': $out"
merge_base=$(git -C "$wt" merge-base FETCH_HEAD HEAD 2>&1) || fail 'fill' "no merge base with '$base_ref': $merge_base"

# docs/adr/README.md exempts the template from the Status rule; --no-renames keeps a renamed ADR
# visible as added.
adrs=()
while IFS= read -r path; do
  [ -n "$path" ] && [ "$path" != "docs/adr/0000-template.md" ] && adrs+=("$path")
done <<EOF
$(git -C "$wt" diff --name-only --no-renames --diff-filter=AM "$merge_base" HEAD -- 'docs/adr/[0-9]*.md')
EOF

feedback_log=$(node -e '
try {
  const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).feedbackLog;
  if (typeof v !== "string" || !v) throw new Error("no feedbackLog key");
  console.log(v);
} catch (e) {
  process.stderr.write(e.message + "\n");
  process.exit(1);
}
' "$wt/.claude/workflow.json" 2>&1) || fail 'fill' ".claude/workflow.json gives no feedbackLog path: $feedback_log"

# Validates every edit before making any: the entry, the category, each ADR's Status. Prints the
# flipped ADR numbers, one per line.
flipped=$(cd "$wt" && node -e '
const fs = require("fs");
const [log, issue, pr, category, verdict, placeholder, ...adrs] = process.argv.slice(1);
const refuse = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(1);
};
const lines = fs.readFileSync(log, "utf8").split("\n");

const vocab = [];
let inVocab = false;
for (const l of lines) {
  if (/^## /.test(l)) inVocab = l === "## Category vocabulary";
  const m = inVocab && /^- \*\*([a-z][a-z-]*)\*\* — /.exec(l);
  if (m) vocab.push(m[1]);
}
if (!vocab.length) refuse(log + " declares no Category vocabulary list");
const bare = category.replace(/ \(.*\)$/, "");
if (!vocab.includes(bare)) refuse("category \"" + bare + "\" is not one " + log + " declares: " + vocab.join(", "));

const heading = new RegExp("^## \\d{4}-\\d{2}-\\d{2} — (?:issue #" + issue + "|PR #" + pr + ") — ");
const catLine = "- **Category**: " + placeholder;
const verLine = "- **Verdict**: " + placeholder;
const entries = [];
let fence = false;
let cur = null;
lines.forEach((l, i) => {
  if (/^```/.test(l)) fence = !fence;
  if (fence || !/^## /.test(l)) {
    if (cur && l === catLine) cur.cat = i;
    if (cur && l === verLine) cur.ver = i;
    return;
  }
  cur = heading.test(l) ? { title: l, cat: -1, ver: -1 } : null;
  if (cur) entries.push(cur);
});
const both = entries.filter((e) => e.cat >= 0 && e.ver >= 0);
const half = entries.filter((e) => (e.cat >= 0) !== (e.ver >= 0));
if (half.length) refuse("entry \"" + half[0].title + "\" carries one placeholder, not both — fill it by hand; this script fills both or neither");
if (both.length !== 1)
  refuse(both.length + " entries headed issue #" + issue + " or PR #" + pr + " carry both placeholders in " + log + "; exactly one must. Already filled? Check git log -1 and push it");

const flips = [];
for (const path of adrs) {
  const text = fs.readFileSync(path, "utf8").split("\n");
  const header = text.findIndex((l) => /^## /.test(l));
  const status = text.slice(0, header < 0 ? text.length : header).map((l, i) => [l, i]).filter(([l]) => /^- \*\*Status:\*\* /.test(l));
  if (status.length !== 1) refuse(path + " has " + status.length + " Status lines in its header; expected one");
  if (status[0][0] !== "- **Status:** proposed") refuse(path + " reads \"" + status[0][0] + "\"; only a proposed ADR is flipped");
  text[status[0][1]] = "- **Status:** accepted";
  flips.push([path, text.join("\n")]);
}

lines[both[0].cat] = "- **Category**: " + category;
lines[both[0].ver] = "- **Verdict**: " + verdict;
fs.writeFileSync(log, lines.join("\n"));
for (const [path, text] of flips) {
  fs.writeFileSync(path, text);
  console.log(/^docs\/adr\/(\d+)-/.exec(path)[1]);
}
' "$feedback_log" "$issue" "$pr_number" "$category" "$verdict" "$PLACEHOLDER" ${adrs[@]+"${adrs[@]}"} 2>&1) ||
  fail 'fill' "$flipped"

changed=("$feedback_log" ${adrs[@]+"${adrs[@]}"})
restore() { git -C "$wt" restore --staged --worktree -- "${changed[@]}" 2>/dev/null; }
adr_clause=""
for n in $flipped; do adr_clause="$adr_clause; ADR $n accepted"; done
step 'fill' "$feedback_log entry filled${adr_clause:+, ${adr_clause#; }}"

# --- step: verify ---------------------------------------------------------------------------

verify_out=$(mktemp "${TMPDIR:-/tmp}/fill-verdict-$pr_number.XXXXXX") || fail 'verify' "mktemp failed"
(cd "$wt" && bash -c "$FILL_VERDICT_VERIFY_CMD") >"$verify_out" 2>&1
verify_rc=$?
root_line=$(grep -m1 '^verify root: ' "$verify_out")
verify_tail=$(tail -n 20 "$verify_out")
rm -f "$verify_out"
step 'verify' "rc=$verify_rc; ${root_line:-no verify root line}"
if [ "$verify_rc" -ne 0 ]; then
  restore
  fail 'verify' "$FILL_VERDICT_VERIFY_CMD exited $verify_rc; tree restored. Last lines:
$verify_tail"
fi
verify_root=${root_line#verify root: }
verify_root=${verify_root% \[*}
if [ -z "$root_line" ] || [ "$(canon "$verify_root")" != "$wt" ]; then
  restore
  fail 'verify' "the verify root line does not name $wt; tree restored"
fi

# --- step: commit ---------------------------------------------------------------------------

# The flag pair is the repo's commit recipe (.claude/skills/review-loop/SKILL.md step 5): strip
# deletes `#`-led lines unless the comment character moves; fill-verdict.test.sh pins both flags.
subject="#$issue: verdict — $category$adr_clause"
out=$(git -C "$wt" add -- "${changed[@]}" 2>&1) || {
  restore
  fail 'commit' "git add failed: $out"
}
out=$(git -C "$wt" -c core.commentChar=';' -c commit.cleanup=strip commit -m "$subject" 2>&1) || {
  restore
  fail 'commit' "git commit failed; tree restored: $out"
}
landed=$(git -C "$wt" log -1 --format=%s)
[ "$landed" = "$subject" ] || fail 'commit' "the commit's subject reads '$landed', not '$subject' — inspect $wt before pushing"
step 'commit' "$(git -C "$wt" rev-parse --short HEAD) $subject"

# --- step: push -----------------------------------------------------------------------------

if [ "$push" = 0 ]; then
  step 'push' "skipped (--no-push)"
  exit 0
fi
out=$(git -C "$wt" push --quiet origin "HEAD:refs/heads/$head_ref" 2>&1) ||
  fail 'push' "committed but not pushed (git push: $out) — push $wt by hand; a re-run refuses, the entry being filled"
step 'push' "origin/$head_ref"
