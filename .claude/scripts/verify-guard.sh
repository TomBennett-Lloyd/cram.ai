#!/usr/bin/env bash
#
# The wrapper `pnpm verify` runs its tier script inside (#700):
#
#   "verify": "pnpm verify:root && bash .claude/scripts/verify-guard.sh -- bash .claude/scripts/verify-tier.sh"
#
# Two things go wrong when several lanes verify on one machine, and this script
# answers each with a mechanism and not a convention.
#
# A RUN ON A MOVING TREE COUNTS FOR NOTHING. A green belongs to the tree it
# read, and a tree edited during the run is no single tree (#680's run edited a
# test file mid-run). So the work tree is stamped once the slot is held and again
# when the command exits, and a difference exits non-zero with
# `verify: tree changed during the run — result void`, even when the command
# passed; a command's own non-zero code is kept. The stamp is HEAD, the
# `git status --porcelain` output, and the tree object of the working tree as
# `git add -A` sees it. tree-hash-lib.sh owns that tree, what it counts and the
# retry when another git process holds the index lock.
#
# FIVE PARALLEL RUNS ON TEN CORES ARE EACH SLOWER THAN ONE, and a load timeout
# turns a green tree red (#483, #700). So a run takes one of N slots first. N is
# max(1, ncpu / 4), a starting value to be tuned with evidence. A slot is a
# directory made with `mkdir` (atomic, and macOS ships no flock(1)) under
# $CRAM_VERIFY_STATE_DIR (see STATE below; one directory for the whole machine, which
# is what makes the cap machine-wide), holding an `owner` file of pid, the pid's
# start time (a reused pid is not the holder; read under LC_ALL=C TZ=UTC so a
# waiter in another locale or zone reads the same string), worktree and epoch.
# A waiting run says it is queued and names the holders.
# A slot whose pid is dead, or alive with another start time, is stale and is
# recovered. Recovery runs under a second mkdir lock, `recover.lock`, because
# judging a slot stale and renaming it must not interleave with another waiter's
# recovery and re-acquisition (it would rename a live holder's fresh lock). Residual:
# a `recover.lock` abandoned by a killed recoverer is itself reclaimed without a lock
# of its own, so two waiters reclaiming it at once while another run is also
# recovering is a race this script does not close.
#
# Not guarded, each for its reason:
#   - `verify:full`, which CI runs: one runner, no shared lock, no wrapper.
#   - a command with `--dry-run`: classification only, no gate to void or queue.
#   - a command started inside a held slot (CRAM_VERIFY_GUARD_HELD is exported
#     to it): a nested `pnpm verify` must not wait on its own parent.
#   - CRAM_VERIFY_SLOTS=0.
#
# Usage: bash .claude/scripts/verify-guard.sh [--] <command> [args...]
#        bash .claude/scripts/verify-guard.sh --slots   print N and exit
# Environment: CRAM_VERIFY_SLOTS (N, 0 disables), CRAM_VERIFY_NCPU (stands in for
#   the core count), CRAM_VERIFY_STATE_DIR, CRAM_VERIFY_POLL (seconds between
#   attempts), CRAM_VERIFY_HEARTBEAT (seconds between "still queued" lines).
# Exit: the command's code; 1 when it passed and the tree moved; 2 when the
#       invocation was wrong or the tree could not be stamped before the run.
#
# The harness is verify-guard.test.sh.
set -uo pipefail
export PATH="$PATH:/opt/homebrew/bin"

POLL=${CRAM_VERIFY_POLL:-2}
HEARTBEAT=${CRAM_VERIFY_HEARTBEAT:-60}
# Polls a slot may stay without an owner file before it counts as abandoned
# between its mkdir and its first write.
GRACE_POLLS=10

die() {
  printf 'verify-guard: %s\n' "$1" >&2
  exit 2
}

is_count() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
}

# slot_count -> N on stdout.
slot_count() {
  local n ncpu
  if [ -n "${CRAM_VERIFY_SLOTS:-}" ]; then
    is_count "$CRAM_VERIFY_SLOTS" || die "CRAM_VERIFY_SLOTS must be a whole number, got '$CRAM_VERIFY_SLOTS'"
    printf '%s\n' "$CRAM_VERIFY_SLOTS"
    return 0
  fi
  ncpu=${CRAM_VERIFY_NCPU:-$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}
  is_count "$ncpu" || die "the core count is not a whole number: '$ncpu'"
  n=$((ncpu / 4))
  [ "$n" -ge 1 ] || n=1
  printf '%s\n' "$n"
}

if [ "${1:-}" = "--slots" ]; then
  slot_count
  exit 0
fi
[ "${1:-}" != "--" ] || shift
[ $# -gt 0 ] || die "usage: verify-guard.sh [--] <command> [args...]"

for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    exec "$@"
  fi
done

N=$(slot_count) || exit 2
if [ "$N" -eq 0 ] || [ -n "${CRAM_VERIFY_GUARD_HELD:-}" ]; then
  exec "$@"
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git work tree, so there is no tree to stamp"
STATE=${CRAM_VERIFY_STATE_DIR:-$HOME/.local/state/cram-verify}
SLOTS="$STATE/verify-slots"
mkdir -p "$SLOTS" || die "cannot create $SLOTS"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || die "cannot resolve the script directory"
# shellcheck source=./tree-hash-lib.sh
. "$SCRIPT_DIR/tree-hash-lib.sh" 2>/dev/null || die "cannot load $SCRIPT_DIR/tree-hash-lib.sh"

# --- the stamp -----------------------------------------------------------------------

# tree_stamp -> three lines on stdout: HEAD, the working tree's tree object, the porcelain status digest.
tree_stamp() {
  local tree head status
  tree=$(worktree_tree "$ROOT") || return 1
  head=$(git -C "$ROOT" rev-parse -q --verify HEAD 2>/dev/null || echo none)
  status=$(git -C "$ROOT" status --porcelain 2>/dev/null | git hash-object --stdin) || return 1
  printf '%s\n%s\n%s\n' "$head" "$tree" "$status"
}

# --- the slots -----------------------------------------------------------------------

HELD=""

proc_start() {
  LC_ALL=C TZ=UTC ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# write_owner <dir>
write_owner() {
  printf '%s\n%s\n%s\n%s\n' "$$" "$(proc_start "$$")" "$ROOT" "$(date +%s)" >"$1/owner.tmp" &&
    mv "$1/owner.tmp" "$1/owner"
}

# lock_state <dir> -> free | pending | live | stale on stdout.
lock_state() {
  local pid start
  [ -d "$1" ] || {
    echo free
    return 0
  }
  [ -f "$1/owner" ] || {
    echo pending
    return 0
  }
  pid=$(sed -n 1p "$1/owner" 2>/dev/null)
  start=$(sed -n 2p "$1/owner" 2>/dev/null)
  is_count "$pid" || {
    echo stale
    return 0
  }
  kill -0 "$pid" 2>/dev/null || {
    echo stale
    return 0
  }
  if [ "$(proc_start "$pid")" != "$start" ]; then
    echo stale
    return 0
  fi
  echo live
}

# lock_try <dir> -> 0 when this process now holds it.
lock_try() {
  mkdir "$1" 2>/dev/null || return 1
  if ! write_owner "$1"; then
    rm -rf "$1"
    return 1
  fi
  return 0
}

# discard <dir> -> renames to a unique name first, so a path is never half-deleted under a taker.
discard() {
  local gone="$1.gone.$$.$RANDOM"
  if mv "$1" "$gone" 2>/dev/null; then
    rm -rf "$gone"
  fi
}

# Consecutive polls recover.lock has been seen without an owner file.
rlock_pending=0

# recover_slot <dir> <grace-met> -> removes the slot when it is stale (or ownerless
# and the caller has waited out the grace), under recover.lock. Returns 1 when
# it could not take recover.lock this time.
recover_slot() {
  local rlock="$SLOTS/recover.lock" state
  if ! lock_try "$rlock"; then
    state=$(lock_state "$rlock")
    if [ "$state" = pending ]; then
      rlock_pending=$((rlock_pending + 1))
    else
      rlock_pending=0
    fi
    if [ "$state" = stale ] || { [ "$state" = pending ] && [ "$rlock_pending" -ge "$GRACE_POLLS" ]; }; then
      discard "$rlock"
    fi
    return 1
  fi
  rlock_pending=0
  state=$(lock_state "$1")
  if [ "$state" = stale ] || { [ "$state" = pending ] && [ "$2" = 1 ]; }; then
    printf 'verify: recovered a stale slot (%s)\n' "$(basename "$1")"
    discard "$1"
  fi
  discard "$rlock"
  return 0
}

release() {
  [ -n "$HELD" ] || return 0
  if [ "$(sed -n 1p "$HELD/owner" 2>/dev/null)" = "$$" ]; then
    discard "$HELD"
  fi
  HELD=""
}

# describe_holders -> one line per held slot.
describe_holders() {
  local i dir pid root since
  i=1
  while [ "$i" -le "$N" ]; do
    dir="$SLOTS/slot-$i"
    if [ -f "$dir/owner" ]; then
      pid=$(sed -n 1p "$dir/owner")
      root=$(sed -n 3p "$dir/owner")
      since=$(sed -n 4p "$dir/owner")
      printf '  slot-%s: pid %s in %s, %ss\n' "$i" "$pid" "$root" "$(($(date +%s) - ${since:-0}))"
    fi
    i=$((i + 1))
  done
}

# Consecutive polls each slot has been seen ownerless, indexed by slot number; a slot
# seen any other way resets to 0, so one ownerless episode is never added to another's.
SLOT_PENDING=()

# acquire -> 0 once a slot is held (HELD names it).
acquire() {
  local i dir state grace_met queued_at="" last_beat=0 now
  while :; do
    i=1
    while [ "$i" -le "$N" ]; do
      dir="$SLOTS/slot-$i"
      if lock_try "$dir"; then
        HELD="$dir"
        return 0
      fi
      state=$(lock_state "$dir")
      if [ "$state" = pending ]; then
        SLOT_PENDING[i]=$(( ${SLOT_PENDING[i]:-0} + 1 ))
      else
        SLOT_PENDING[i]=0
      fi
      grace_met=0
      [ "${SLOT_PENDING[i]}" -lt "$GRACE_POLLS" ] || grace_met=1
      if [ "$state" = stale ] || [ "$grace_met" = 1 ]; then
        if recover_slot "$dir" "$grace_met" && lock_try "$dir"; then
          HELD="$dir"
          return 0
        fi
      fi
      i=$((i + 1))
    done
    now=$(date +%s)
    if [ -z "$queued_at" ]; then
      queued_at=$now
      last_beat=$now
      printf 'verify: queued — all %s slot(s) held:\n' "$N"
      describe_holders
    elif [ $((now - last_beat)) -ge "$HEARTBEAT" ]; then
      last_beat=$now
      printf 'verify: still queued after %ss\n' "$((now - queued_at))"
    fi
    sleep "$POLL"
  done
}

trap release EXIT
trap 'release; exit 130' INT
trap 'release; exit 143' TERM
trap 'release; exit 129' HUP

acquire
printf 'verify: holding %s of %s slot(s)\n' "$(basename "$HELD")" "$N"

before=$(tree_stamp) || die "could not stamp the work tree"

export CRAM_VERIFY_GUARD_HELD=1
"$@"
rc=$?

if ! after=$(tree_stamp); then
  printf 'verify: could not stamp the work tree after the run — result void\n' >&2
  [ "$rc" -ne 0 ] || rc=1
  exit "$rc"
fi
if [ "$before" != "$after" ]; then
  printf 'verify: tree changed during the run — result void\n' >&2
  [ "$rc" -ne 0 ] || rc=1
fi
release
exit "$rc"
