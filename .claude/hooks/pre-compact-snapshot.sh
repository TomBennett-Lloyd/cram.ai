#!/usr/bin/env bash
#
# PreCompact hook: write the compacting agent's repo state to a file, so the SessionStart
# `compact` hook (post-compact-reinject.sh) can put it back in front of the model once the
# transcript has been summarised. Why a pair, where the file lives, what it holds and which
# trees it writes for (lanes only): compaction-lib.sh. Introduced by #629.
#
# Non-blocking by contract: always exits 0, and says nothing on stdout (PreCompact's stdout
# goes to the debug log; its exit code 2 would BLOCK the compaction, and a lane that cannot
# compact at its window is the failure this hook exists to prevent). A failure to snapshot
# is reported on stderr and costs the re-injection its stored copy, which it recomputes.
#
set -u
export PATH="/opt/homebrew/bin:$PATH"

lib="$(dirname -- "${BASH_SOURCE[0]}")/hook-context.sh"
clib="$(dirname -- "${BASH_SOURCE[0]}")/compaction-lib.sh"
# shellcheck source=./hook-context.sh
if ! . "$lib"; then
  echo "pre-compact-snapshot: could not load $lib — no snapshot was written." >&2
  exit 0
fi
# shellcheck source=./compaction-lib.sh
if ! . "$clib"; then
  echo "pre-compact-snapshot: could not load $clib — no snapshot was written." >&2
  exit 0
fi

hook_require_tools pre-compact-snapshot "$HOOK_NODE_CMD" git || exit 0

event=$(read_hook_event) || {
  echo "pre-compact-snapshot: could not read the hook event (stdin was unreadable or held open for ${HOOK_EVENT_TIMEOUT_S}s) — no snapshot was written; the re-injection recomputes the state." >&2
  exit 0
}
cwd=$(hook_event_field "$event" cwd) || {
  echo "pre-compact-snapshot: could not read the hook event ($HOOK_NODE_CMD failed) — no snapshot was written." >&2
  exit 0
}
trigger=$(hook_event_field "$event" trigger) || exit 0
agent_type=$(hook_event_field "$event" agent_type) || exit 0
agent_id=$(hook_event_field "$event" agent_id) || exit 0

root=$(repo_root_for "${cwd:-$PWD}") || exit 0
[ -n "$(compaction_issue "$(compaction_branch "$root")")" ] || exit 0
file=$(compaction_state_file "$root" "$(compaction_key "$agent_id")")

if ! compaction_snapshot "$root" "$trigger" "$agent_type" "${cwd:-$PWD}" >"$file" 2>/dev/null; then
  echo "pre-compact-snapshot: could not write $file — the re-injection will recompute the state." >&2
fi
exit 0
