#!/usr/bin/env bash
#
# SessionStart hook, matcher `compact` (.claude/settings.json): after a compaction, add the
# agent's repo state, a pointer to its plan comment and the instruction to reconcile before
# continuing to the compacted context. Its stdout is that channel
# (https://code.claude.com/docs/en/hooks.md). Pair, file location and what the state holds:
# compaction-lib.sh. Introduced by #629.
#
# The state is the snapshot pre-compact-snapshot.sh stored for this agent when it is fresh
# (compaction_snapshot_fresh), consumed so a later compaction cannot read it again, and
# recomputed otherwise: PreCompact may not fire where SessionStart does.
#
# Only a LANE is handed this: a branch named `<issue>-<slug>`, the shape
# `.claude/agents/ticket-agent.md` rule 1 creates (compaction-lib.sh reads it through a
# rebase). A session on `main` or a plain detached HEAD has no issue to reconcile against, and
# the hook stays silent by design (hook-context.sh).
#
# The text is addressed to both readers a lane's worktree has: the agent that owns the lane
# and an agent it dispatched there (a reviewer, consultant, planner), which is told its own
# task is unchanged. It cannot be addressed to one of them by agent_type: a live run (#629)
# showed PreCompact and SessionStart-compact events carry neither agent_id nor agent_type, even
# when the compaction is a subagent's.
#
# The pointer names `gh` commands; it never runs them — a hook that reached GitHub would be
# a network call on every compaction (CLAUDE.md Hard constraints).
#
# Non-blocking by contract: always exits 0.
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

lib="$(dirname -- "${BASH_SOURCE[0]}")/hook-context.sh"
clib="$(dirname -- "${BASH_SOURCE[0]}")/compaction-lib.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "post-compact-reinject: could not load $lib — nothing was re-injected." >&2
  exit 0
fi
# shellcheck source=./compaction-lib.sh
if ! . "$clib"; then
  echo "post-compact-reinject: could not load $clib — nothing was re-injected." >&2
  exit 0
fi

hook_require_tools post-compact-reinject "$HOOK_NODE_CMD" git || exit 0

# An event that cannot be read (stdin held open past HOOK_EVENT_TIMEOUT_S) degrades to the
# recompute: no cwd means the hook's own working directory, which Claude Code sets to the
# session's, and the state is then git's alone. It never blocks.
event=$(read_hook_event) || {
  echo "post-compact-reinject: could not read the hook event (stdin was unreadable or held open for ${HOOK_EVENT_TIMEOUT_S}s) — recomputing the state from $PWD." >&2
  event=""
}
cwd=$(hook_event_field "$event" cwd) || {
  echo "post-compact-reinject: could not read the hook event ($HOOK_NODE_CMD failed) — nothing was re-injected." >&2
  exit 0
}
agent_type=$(hook_event_field "$event" agent_type) || exit 0
agent_id=$(hook_event_field "$event" agent_id) || exit 0

root=$(repo_root_for "${cwd:-$PWD}") || exit 0
branch=$(compaction_branch "$root")
issue=$(compaction_issue "$branch")
[ -n "$issue" ] || exit 0

file=$(compaction_state_file "$root" "$(compaction_key "$agent_id")") || file=""
state=""
if [ -n "$file" ] && [ -f "$file" ]; then
  if compaction_snapshot_fresh "$file"; then
    state=$(cat "$file" 2>/dev/null)
  fi
  rm -f "$file"
fi
[ -n "$state" ] || state=$(compaction_snapshot "$root" "" "$agent_type" "${cwd:-$PWD}")

cat <<TEXT
Your context was just compacted. What follows is repo state, not memory: it was written by a hook, never from the conversation.

$state

This is the state of the lane for issue #$issue. If you are the agent that owns that lane, reconcile from what survives compaction, in this order:
1. \`git log --oneline origin/main..HEAD\` and \`git status --short\` in the worktree above: what is committed and what is not. If the state says \`rebase: in progress\`, finish or abort that rebase first.
2. Issue #$issue's plan comment (\`gh issue view $issue --comments\`, the one headed \`## Plan (ticket-agent lane)\`): its ticked steps say which steps are done.
3. Any open PR for the branch (\`gh pr list --head $branch\`): its body, checks and review state.
Then continue from the first step that is neither committed nor ticked. Do not redo a ticked step, and do not trust a recollection of the conversation over these three.

If you were dispatched by that agent for a narrower task (a review, a consultation, a plan), none of this changes your task: the state is the lane's, for orientation, and you do not take up its steps.
TEXT
exit 0
