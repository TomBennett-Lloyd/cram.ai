#!/usr/bin/env bash
# Commit-subject gate: on a lane branch, every non-merge commit since origin/main begins
# `#<n>: ` (.claude/agents/ticket-agent.md rule 4, #671).
#
# The rule was prose with no check, and a lane's commit subjects are what a reader of the PR's
# history sees first; the branch squash-merges, so a bad subject never reaches main but the
# portfolio's commit history is read on the PR. A lane branch is one named `<n>-<slug>`
# (.claude/skills/execute/SKILL.md step 1); retro and triage branches are the merge owner's
# and are skipped, as is main itself.
#
# Merge commits are exempt, because the subjects of three of them are not the lane's to write:
# `gh pr update-branch`, GitHub's synthetic `Merge <sha> into <sha>` commit on a pull_request
# checkout, and merge-pr.sh's append-only-log union commit. A lane's own `merge origin/main`
# carries `#<n>:` by .claude/skills/eval-lane/SKILL.md § 2 and is not checked.
#
# Branch name: $GITHUB_HEAD_REF when set (a pull_request checkout is detached), else the
# checked-out branch. Fails closed when origin/main does not resolve.
#
# Usage: bash .claude/scripts/check-commit-subjects.sh [REPO_ROOT]   (or `pnpm check:commit-subjects`)
# Exit:  0 every subject conforms or the branch is not a lane branch, 1 at least one does not,
#        2 the range could not be read.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
ROOT=${1:-"$SCRIPT_DIR/../.."}
ROOT=$(cd "$ROOT" && pwd -P) || exit 2

branch=${GITHUB_HEAD_REF:-}
[ -n "$branch" ] || branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
  echo "check-commit-subjects: cannot read the current branch in $ROOT" >&2
  exit 2
}

if ! [[ "$branch" =~ ^[0-9]+- ]]; then
  echo "check-commit-subjects: OK — '$branch' is not a lane branch (<n>-<slug>), nothing to check"
  exit 0
fi

git -C "$ROOT" rev-parse -q --verify refs/remotes/origin/main >/dev/null || {
  echo "check-commit-subjects: origin/main does not resolve in $ROOT, so the branch's commits cannot be listed (run git fetch origin)" >&2
  exit 2
}

subjects=$(git -C "$ROOT" log --no-merges --format='%h %s' origin/main..HEAD) || {
  echo "check-commit-subjects: git log origin/main..HEAD failed in $ROOT" >&2
  exit 2
}

total=0
bad=0
pattern='^#[0-9]+: '
while IFS= read -r line; do
  [ -n "$line" ] || continue
  total=$((total + 1))
  if ! [[ "${line#* }" =~ $pattern ]]; then
    bad=$((bad + 1))
    printf 'ERROR %s\n' "$line" >&2
  fi
done <<EOF2
$subjects
EOF2

if [ "$bad" -gt 0 ]; then
  printf 'check-commit-subjects: %d of %d commit subject(s) on %s do not begin with #<n>: and a space\n' "$bad" "$total" "$branch" >&2
  exit 1
fi
echo "check-commit-subjects: OK — $total commit subject(s) on $branch"
