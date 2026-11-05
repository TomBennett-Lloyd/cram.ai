#!/usr/bin/env bash
#
# Shared helpers for the two compaction hooks, pre-compact-snapshot.sh and
# post-compact-reinject.sh (#629). Sourced, never executed.
#
# WHY THERE IS A PAIR. PreCompact cannot tell the model anything: its stdout goes to the
# debug log (https://code.claude.com/docs/en/hooks.md). SessionStart with matcher
# `compact` can: its stdout joins the compacted context. So the first hook writes state to
# disk and the second puts it back in front of the model. The branch, commits and paths in
# it are git's, so the second hook recomputes them (compaction_snapshot below) when no fresh
# file exists; the trigger and agent_type come from the event and are then `unknown` or absent.
#
# ONLY A LANE IS SNAPSHOT: a branch named `<issue>-<slug>`, the shape ticket-agent.md rule 1
# creates, which compaction_branch reads even while a rebase has HEAD detached. Both hooks
# apply the same test, so a tree the second hook would never read is never written to — the
# parked main checkout's git directory included, which nothing removes.
#
# THE FILE LIVES IN THE GIT DIRECTORY, not the work tree. `git rev-parse --git-path`
# names `.git/worktrees/<name>/…` for a linked worktree: per worktree, never tracked,
# removed with the worktree, and invisible to the `git status --short` the snapshot
# itself reports. A file inside the tree would make every lane's status dirty or need a
# `.gitignore` line.
#
# WHICH TREE comes from the event's `cwd`, never $CLAUDE_PROJECT_DIR (hook-context.sh).
#
# NEVER READ FILE CONTENT. The snapshot names paths (`git status --short`) and commit
# subjects; no content of any file reaches it, so course material cannot (CLAUDE.md Hard
# constraints). It runs local git reads only: no fetch, no `gh`, no network.
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "compaction-lib.sh is a sourced library, not an executable script" >&2
  exit 2
fi

# The most lines of `git log` and of `git status --short` the snapshot carries. A lane
# that is 60 commits ahead is not helped by 60 subjects in the context it just compacted.
COMPACTION_LIST_CAP=40

# How old a stored snapshot may be and still be believed, in minutes (`find -mmin`). PreCompact and the SessionStart that follows are two events of
# one compaction, seconds to a minute apart; a file older than this belongs to some earlier
# compaction whose state has moved on.
COMPACTION_SNAPSHOT_MAX_AGE_MIN=15

# compaction_snapshot_fresh <file> -> 0 when the stored snapshot is young enough to be believed.
compaction_snapshot_fresh() {
  [ -n "$(find "$1" -mmin "-$COMPACTION_SNAPSHOT_MAX_AGE_MIN" 2>/dev/null)" ]
}

# compaction_key <agent_id> -> the file-name suffix: the agent's id reduced to [A-Za-z0-9_-],
# or `main` when the event carried none. Keyed because a lane and a reviewer it dispatched
# share one worktree and can compact independently.
compaction_key() {
  local key
  key=$(printf '%s' "$1" | tr -cd 'A-Za-z0-9_-')
  printf '%s' "${key:-main}"
}

# compaction_state_file <root> <key> -> the absolute path the snapshot is kept at.
compaction_state_file() {
  git -C "$1" rev-parse --path-format=absolute --git-path "cram-compaction-snapshot.$2" 2>/dev/null
}

# compaction_rebase_file <root> <name> -> the absolute path of <name> in the rebase state.
compaction_rebase_file() {
  git -C "$1" rev-parse --path-format=absolute --git-path "$2" 2>/dev/null
}

# compaction_branch <root> -> the branch name; empty on a plain detached HEAD. A rebase
# detaches HEAD, so during one the name is read from the rebase's own record: a lane
# resolving a rebase conflict (ticket-agent.md rule 8) is the state it can least afford to lose.
compaction_branch() {
  local name file
  if name=$(git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null); then
    printf '%s' "$name"
    return 0
  fi
  for name in rebase-merge/head-name rebase-apply/head-name; do
    file=$(compaction_rebase_file "$1" "$name")
    if [ -f "$file" ]; then
      name=$(cat "$file" 2>/dev/null)
      printf '%s' "${name#refs/heads/}"
      return 0
    fi
  done
}

# compaction_rebasing <root> -> 0 while a rebase is in progress.
compaction_rebasing() {
  [ -d "$(compaction_rebase_file "$1" rebase-merge)" ] || [ -f "$(compaction_rebase_file "$1" rebase-apply/head-name)" ]
}

# compaction_issue <branch> -> the issue number when the branch is `<digits>-<slug>`, else
# empty. The lane convention (`.claude/agents/ticket-agent.md` rule 1) is the only shape
# that names an issue; `629`, `v629-x` and `x-629` do not.
compaction_issue() {
  printf '%s' "$1" | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p'
}

# compaction_snapshot <root> <trigger> <agent_type> <cwd> -> the state block on stdout.
compaction_snapshot() {
  local root="$1" trigger="$2" agent_type="$3" cwd="$4" branch issue ahead shown
  branch=$(compaction_branch "$root")
  issue=$(compaction_issue "$branch")

  printf 'Compaction snapshot (repo state only)\n'
  printf 'taken: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'trigger: %s\n' "${trigger:-unknown}"
  [ -n "$agent_type" ] && printf 'agent_type: %s\n' "$agent_type"
  printf 'cwd: %s\n' "${cwd:-$root}"
  printf 'worktree: %s\n' "$root"
  printf 'branch: %s\n' "$branch"
  compaction_rebasing "$root" && printf 'rebase: in progress\n'
  [ -n "$issue" ] && printf 'issue: #%s\n' "$issue"

  if ahead=$(git -C "$root" rev-list --count origin/main..HEAD 2>/dev/null); then
    shown=$((ahead < COMPACTION_LIST_CAP ? ahead : COMPACTION_LIST_CAP))
    printf 'commits ahead of origin/main: %s (git log --oneline origin/main..HEAD, newest first, showing %s)\n' "$ahead" "$shown"
    git -C "$root" log --oneline -n "$COMPACTION_LIST_CAP" origin/main..HEAD 2>/dev/null
  else
    printf 'commits ahead of origin/main: unknown (no origin/main ref in this repository)\n'
  fi

  local status_lines total
  status_lines=$(git -C "$root" status --short 2>/dev/null)
  if [ -z "$status_lines" ]; then
    printf 'git status --short: clean\n'
  else
    total=$(printf '%s\n' "$status_lines" | wc -l | tr -d ' ')
    shown=$((total < COMPACTION_LIST_CAP ? total : COMPACTION_LIST_CAP))
    printf 'git status --short: %s changed paths, showing %s\n' "$total" "$shown"
    printf '%s\n' "$status_lines" | head -n "$COMPACTION_LIST_CAP"
  fi
}
