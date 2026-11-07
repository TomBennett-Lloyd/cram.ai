#!/usr/bin/env bash
#
# Harness for .claude/scripts/verify-guard.sh: the tree stamp (a run whose tree
# moved is void), the slot semaphore (an (N+1)th run waits, then runs), and the
# recovery of a lock a killed run left behind. Every case runs the guard around a
# stub command in a throwaway repository and a throwaway state directory; the real
# `pnpm verify` is never started.
#
# Usage: bash .claude/scripts/verify-guard.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
GUARD=${VERIFY_GUARD_SCRIPT:-$SCRIPTS/verify-guard.sh}
REPO_ROOT=$(cd "$SCRIPTS/../.." && pwd) || exit 2

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

BG_PIDS=""
harness_extra_cleanup() {
  local p
  for p in $BG_PIDS; do
    kill "$p" 2>/dev/null
  done
  touch "$TMP_ROOT"/release-* 2>/dev/null
}

REPO="$TMP_ROOT/repo"
PLAIN="$TMP_ROOT/plain"
STUBS="$TMP_ROOT/stubs"
must mkdir -p "$PLAIN" "$STUBS"
must git init -q -b main "$REPO"
must git -C "$REPO" config user.email "harness@example.invalid"
must git -C "$REPO" config user.name "Harness"
must git -C "$REPO" config commit.gpgsign false
printf 'ignored/\n' >"$REPO/.gitignore" || exit 2
printf 'one\n' >"$REPO/tracked.txt" || exit 2
must mkdir -p "$REPO/ignored"
printf 'cache\n' >"$REPO/ignored/cache.txt" || exit 2
must git -C "$REPO" add -A
must git -C "$REPO" commit -q -m seed
printf 'draft\n' >"$REPO/untracked.txt" || exit 2

stub() { # stub <name> < body -> $STUBS/<name>; the body arrives by heredoc so $-expansions stay literal
  { printf '#!/usr/bin/env bash\n'; cat; } >"$STUBS/$1" || exit 2
}
# Stubs run with the repository as their cwd (capture -C). hold.sh says it started, then waits for its release file.
stub pass.sh <<'EOF'
echo "stub ran"
EOF
stub fail7.sh <<'EOF'
exit 7
EOF
stub edit-tracked.sh <<'EOF'
echo two >> tracked.txt
EOF
stub edit-untracked.sh <<'EOF'
echo more >> untracked.txt
EOF
stub add-untracked.sh <<'EOF'
echo new > brand-new.txt
EOF
stub edit-ignored.sh <<'EOF'
echo more >> ignored/cache.txt
EOF
stub commit-empty.sh <<'EOF'
git commit -q --allow-empty -m moved
EOF
stub stage-only.sh <<'EOF'
git add untracked.txt
EOF
stub edit-and-fail.sh <<'EOF'
echo three >> tracked.txt; exit 7
EOF
stub show-held.sh <<'EOF'
echo "held=${CRAM_VERIFY_GUARD_HELD:-unset}"
EOF
stub args.sh <<'EOF'
echo "args: $*"
EOF
stub hold.sh <<'EOF'
touch "$STUB_DIR/started-$1"; while [ ! -e "$STUB_DIR/release-$1" ]; do sleep 0.1; done
EOF
stub corrupt-index.sh <<'EOF'
echo garbage > "$(git rev-parse --git-dir)/index"
EOF
stub steal-owner.sh <<'EOF'
printf '%s\n%s\n%s\n%s\n' "$STUB_PID" "$STUB_START" "/elsewhere" "1" > "$CRAM_VERIFY_STATE_DIR/verify-slots/slot-1/owner"
EOF
stub mark.sh <<'EOF'
touch "$STUB_DIR/ran-$1"
EOF

# reset_repo -> the fixture back to its seeded state, whatever a case did to it.
reset_repo() {
  rm -f "$REPO/.git/index"
  must git -C "$REPO" reset -q --hard seed_ref
  must git -C "$REPO" clean -fdq -e untracked.txt
  must git -C "$REPO" checkout -q main
  printf 'draft\n' >"$REPO/untracked.txt" || exit 2
  printf 'cache\n' >"$REPO/ignored/cache.txt" || exit 2
}
must git -C "$REPO" tag seed_ref

fresh_state() { # fresh_state -> STATE, an empty state directory
  STATE=$(mktemp -d "$TMP_ROOT/state.XXXXXX") || exit 2
}

# guard <slots> <command...> -> capture of one guarded run in the fixture repo. The env -u
# matters: this harness runs under `pnpm verify`, whose guard exports CRAM_VERIFY_GUARD_HELD
# to everything below it, and a harness that inherited it would test the nested arm only.
guard() {
  local slots="$1"
  shift
  capture -C "$REPO" env -u CRAM_VERIFY_GUARD_HELD -u CRAM_VERIFY_SLOTS -u CRAM_VERIFY_NCPU \
    CRAM_VERIFY_STATE_DIR="$STATE" CRAM_VERIFY_SLOTS="$slots" CRAM_VERIFY_POLL=0.1 \
    CRAM_VERIFY_HEARTBEAT=1 STUB_DIR="$TMP_ROOT" bash "$GUARD" "$@"
}

# guard_bg <name> <slots> <command...> -> a guarded run in the background, output in
# $TMP_ROOT/bg-<name>.out, pid in BG_PID.
guard_bg() {
  local name="$1" slots="$2"
  shift 2
  (cd "$REPO" && exec env -u CRAM_VERIFY_GUARD_HELD -u CRAM_VERIFY_SLOTS -u CRAM_VERIFY_NCPU \
    CRAM_VERIFY_STATE_DIR="$STATE" CRAM_VERIFY_SLOTS="$slots" CRAM_VERIFY_POLL=0.1 \
    CRAM_VERIFY_HEARTBEAT=1 STUB_DIR="$TMP_ROOT" bash "$GUARD" "$@") >"$TMP_ROOT/bg-$name.out" 2>&1 &
  BG_PID=$!
  BG_PIDS="$BG_PIDS $BG_PID"
}

# wait_for <path> -> 0 once it exists, 1 after about ten seconds.
wait_for() {
  local i=0
  while [ ! -e "$1" ]; do
    i=$((i + 1))
    [ "$i" -lt 100 ] || return 1
    sleep 0.1
  done
}

# wait_for_text <file> <fixed-string> -> 0 once the file holds it, 1 after about ten seconds.
wait_for_text() {
  local i=0
  until grep -qF -- "$2" "$1" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 100 ] || return 1
    sleep 0.1
  done
}

slot_dirs() { # slot_dirs -> the number of slot directories left in STATE
  find "$STATE/verify-slots" -maxdepth 1 -name 'slot-*' 2>/dev/null | grep -c .
}

dead_pid() { # dead_pid -> the pid of a process that has exited
  local p
  sh -c 'exit 0' &
  p=$!
  wait "$p"
  printf '%s\n' "$p"
}

fake_slot() { # fake_slot <n> <pid> <lstart> -> a slot dir owned by that pid and start time
  local d="$STATE/verify-slots/slot-$1"
  must mkdir -p "$d"
  printf '%s\n%s\n%s\n%s\n' "$2" "$3" "/elsewhere" "$(date +%s)" >"$d/owner"
}

own_start() { ps -o lstart= -p "$$" | sed 's/^ *//; s/ *$//'; }

# --- the tree stamp -------------------------------------------------------------------

begin "an untouched run passes and keeps the command's output"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "stub ran"
expect_not_out "result void"
end

begin "a tracked file edited mid-run is void and exits non-zero"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/edit-tracked.sh"
expect_rc 1
expect_stderr "verify: tree changed during the run — result void"
end

begin "an untracked file edited mid-run is void"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/edit-untracked.sh"
expect_rc 1
expect_stderr "verify: tree changed during the run — result void"
end

begin "a new untracked file created mid-run is void"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/add-untracked.sh"
expect_rc 1
expect_stderr "result void"
end

begin "a commit mid-run is void (HEAD moved, the tree did not)"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/commit-empty.sh"
expect_rc 1
expect_stderr "result void"
end

begin "staging mid-run is void (the content did not change, the status did)"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/stage-only.sh"
expect_rc 1
expect_stderr "result void"
end

begin "an ignored file edited mid-run does not void the run"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/edit-ignored.sh"
expect_rc 0
expect_not_out "result void"
end

begin "the command's own failing code is kept, with and without a moved tree"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/fail7.sh"
expect_rc 7
expect_not_out "result void"
reset_repo
guard 2 -- bash "$STUBS/edit-and-fail.sh"
expect_rc 7
expect_stderr "result void"
end

# --- slot count ------------------------------------------------------------------------

begin "N is max(1, ncpu/4), CRAM_VERIFY_SLOTS overrides, a non-number is refused"
for pair in "10 2" "16 4" "3 1" "1 1" "4 1" "8 2"; do
  read -r ncpu want <<<"$pair"
  case_ctx="ncpu=$ncpu"
  capture env -u CRAM_VERIFY_SLOTS CRAM_VERIFY_NCPU="$ncpu" bash "$GUARD" --slots
  expect_rc 0
  [ "$out" = "$want" ] || bad "expected $want slots for ncpu $ncpu, got '$out'"
done
case_ctx="CRAM_VERIFY_SLOTS=3"
capture env CRAM_VERIFY_SLOTS=3 CRAM_VERIFY_NCPU=40 bash "$GUARD" --slots
[ "$out" = "3" ] || bad "override ignored, got '$out'"
case_ctx="CRAM_VERIFY_SLOTS=abc"
capture env CRAM_VERIFY_SLOTS=abc bash "$GUARD" --slots
expect_rc 2
case_ctx=""
end

# --- the semaphore -----------------------------------------------------------------------

begin "an (N+1)th concurrent run waits, says it is queued, then runs once a slot frees"
fresh_state
reset_repo
guard_bg a 2 -- bash "$STUBS/hold.sh" a
pid_a=$BG_PID
guard_bg b 2 -- bash "$STUBS/hold.sh" b
pid_b=$BG_PID
wait_for "$TMP_ROOT/started-a" || bad "holder a never started"
wait_for "$TMP_ROOT/started-b" || bad "holder b never started"
guard_bg c 2 -- bash "$STUBS/mark.sh" c
pid_c=$BG_PID
wait_for_text "$TMP_ROOT/bg-c.out" "verify: queued" || bad "the third run never said it was queued"
wait_for_text "$TMP_ROOT/bg-c.out" "still queued" || bad "the queued run printed no heartbeat"
[ ! -e "$TMP_ROOT/ran-c" ] || bad "the third run ran while both slots were held"
grep -qF "slot-1: pid" "$TMP_ROOT/bg-c.out" || bad "the queued line does not name a holder"
touch "$TMP_ROOT/release-a"
wait_for "$TMP_ROOT/ran-c" || bad "the third run never ran after a slot freed"
wait "$pid_c" || bad "the third run did not exit 0"
touch "$TMP_ROOT/release-b"
wait "$pid_a"
wait "$pid_b"
[ "$(slot_dirs)" = "0" ] || bad "slots were left behind after every run exited: $(slot_dirs)"
end

begin "a slot is released after a passing run and after a failing one"
fresh_state
reset_repo
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
[ "$(slot_dirs)" = "0" ] || bad "slot left after a pass"
guard 1 -- bash "$STUBS/fail7.sh"
expect_rc 7
[ "$(slot_dirs)" = "0" ] || bad "slot left after a fail"
end

begin "the run prints which slot it holds"
fresh_state
reset_repo
guard 2 -- bash "$STUBS/pass.sh"
expect_stdout "verify: holding slot-1 of 2 slot(s)"
end

# --- stale locks ------------------------------------------------------------------------------

begin "a slot whose pid is dead is recovered"
fresh_state
reset_repo
fake_slot 1 "$(dead_pid)" "Thu Jan  1 00:00:00 1970"
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "recovered a stale slot"
expect_not_stdout "verify: queued"
expect_stdout "stub ran"
end

begin "a dead pid whose start time reads empty (the same as the live-check's own answer for it) is still stale"
fresh_state
reset_repo
fake_slot 1 "$(dead_pid)" ""
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "recovered a stale slot"
expect_not_stdout "verify: queued"
end

begin "an owner file naming a pid that is not a whole number (-1 signals every process) is stale"
fresh_state
reset_repo
fake_slot 1 "-1" ""
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "recovered a stale slot"
expect_not_stdout "verify: queued"
end

begin "a slot whose pid is alive with another start time (pid reuse) is recovered"
fresh_state
reset_repo
fake_slot 1 "$$" "Thu Jan  1 00:00:00 1970"
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "recovered a stale slot"
end

begin "a slot held by a live process with its real start time is not taken, and frees when that process is gone"
fresh_state
reset_repo
fake_slot 1 "$$" "$(own_start)"
guard_bg live 1 -- bash "$STUBS/mark.sh" live
pid_live=$BG_PID
wait_for_text "$TMP_ROOT/bg-live.out" "verify: queued" || bad "no queued line behind a live holder"
sleep 0.5
[ ! -e "$TMP_ROOT/ran-live" ] || bad "the run took a slot a live process holds"
printf '%s\n%s\n%s\n%s\n' "$(dead_pid)" "x" "/elsewhere" "1" >"$STATE/verify-slots/slot-1/owner"
wait_for "$TMP_ROOT/ran-live" || bad "the run never recovered the slot once its holder died"
wait "$pid_live" || bad "the waiting run did not exit 0"
end

begin "a guard killed with SIGKILL leaves a lock the next run recovers"
fresh_state
reset_repo
rm -f "$TMP_ROOT/started-k" "$TMP_ROOT/release-k"
guard_bg k 1 -- bash "$STUBS/hold.sh" k
pid_k=$BG_PID
wait_for "$TMP_ROOT/started-k" || bad "holder k never started"
kill -9 "$pid_k"
wait "$pid_k" 2>/dev/null
[ "$(slot_dirs)" = "1" ] || bad "SIGKILL was expected to leave the slot behind, found $(slot_dirs)"
touch "$TMP_ROOT/release-k"
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "recovered a stale slot"
end

begin "a slot directory with no owner file is waited on, then recovered after the grace polls"
fresh_state
reset_repo
must mkdir -p "$STATE/verify-slots/slot-1"
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 0
expect_stdout "verify: queued"
expect_stdout "recovered a stale slot"
end

begin "a slot another process took over is not removed by the run that lost it"
fresh_state
reset_repo
capture -C "$REPO" env -u CRAM_VERIFY_GUARD_HELD -u CRAM_VERIFY_NCPU CRAM_VERIFY_STATE_DIR="$STATE" \
  CRAM_VERIFY_SLOTS=1 CRAM_VERIFY_POLL=0.1 STUB_PID="$$" STUB_START="$(own_start)" bash "$GUARD" -- bash "$STUBS/steal-owner.sh"
expect_rc 0
[ "$(slot_dirs)" = "1" ] || bad "the run removed a slot whose owner file names another live process"
[ "$(sed -n 1p "$STATE/verify-slots/slot-1/owner")" = "$$" ] || bad "the owner file was not left as the other process wrote it"
end

begin "SIGTERM and SIGHUP let the command finish, then release the slot and exit 143 and 129"
for pair in "TERM 143" "HUP 129"; do
  read -r sig want <<<"$pair"
  case_ctx="SIG$sig"
  fresh_state
  reset_repo
  rm -f "$TMP_ROOT/started-t" "$TMP_ROOT/release-t"
  guard_bg t 1 -- bash "$STUBS/hold.sh" t
  pid_t=$BG_PID
  wait_for "$TMP_ROOT/started-t" || bad "holder t never started"
  kill -"$sig" "$pid_t"
  touch "$TMP_ROOT/release-t"
  wait "$pid_t"
  rc_t=$?
  [ "$rc_t" = "$want" ] || bad "expected exit $want after SIG$sig, got $rc_t"
  [ "$(slot_dirs)" = "0" ] || bad "the slot was left behind after SIG$sig"
done
case_ctx=""
end

# --- a stamp that cannot be taken ---------------------------------------------------------------

begin "a tree that cannot be stamped before the run is refused, and one that cannot after it is void"
fresh_state
reset_repo
printf 'garbage\n' >"$REPO/.git/index"
guard 1 -- bash "$STUBS/pass.sh"
expect_rc 2
expect_stderr "could not stamp the work tree"
expect_not_stdout "stub ran"
reset_repo
guard 1 -- bash "$STUBS/corrupt-index.sh"
expect_rc 1
expect_stderr "could not stamp the work tree after the run — result void"
reset_repo
end

# --- not guarded -------------------------------------------------------------------------------

begin "the child sees CRAM_VERIFY_GUARD_HELD, and a run inside a held slot takes no slot"
fresh_state
reset_repo
guard 1 -- bash "$STUBS/show-held.sh"
expect_stdout "held=1"
capture -C "$REPO" env CRAM_VERIFY_GUARD_HELD=1 CRAM_VERIFY_STATE_DIR="$STATE" CRAM_VERIFY_SLOTS=1 bash "$GUARD" -- bash "$STUBS/show-held.sh"
expect_rc 0
expect_stdout "held=1"
expect_not_stdout "verify: holding"
end

begin "a --dry-run command runs unguarded and takes no slot"
fresh_state
reset_repo
guard 1 -- bash "$STUBS/args.sh" --dry-run
expect_rc 0
expect_stdout "args: --dry-run"
expect_not_stdout "verify: holding"
[ ! -d "$STATE/verify-slots" ] || bad "a dry run created the slot directory"
end

begin "CRAM_VERIFY_SLOTS=0 disables the guard"
fresh_state
reset_repo
guard 0 -- bash "$STUBS/edit-tracked.sh"
expect_rc 0
expect_not_out "result void"
[ ! -d "$STATE/verify-slots" ] || bad "a disabled guard created the slot directory"
end

begin "a missing command is a usage error, and so is a directory that is not a work tree"
fresh_state
capture -C "$REPO" env -u CRAM_VERIFY_GUARD_HELD bash "$GUARD"
expect_rc 2
expect_stderr "usage"
capture -C "$PLAIN" env -u CRAM_VERIFY_GUARD_HELD CRAM_VERIFY_STATE_DIR="$STATE" CRAM_VERIFY_SLOTS=1 bash "$GUARD" -- true
expect_rc 2
expect_stderr "not inside a git work tree"
end

# --- the wiring ------------------------------------------------------------------------------------

begin "package.json routes verify through the guard and leaves verify:full, which CI runs, alone"
verify_cmd=$(node -e 'process.stdout.write(require(process.argv[1]).scripts.verify)' "$REPO_ROOT/package.json")
full_cmd=$(node -e 'process.stdout.write(require(process.argv[1]).scripts["verify:full"])' "$REPO_ROOT/package.json")
case "$verify_cmd" in
  *"verify-guard.sh -- bash .claude/scripts/verify-tier.sh"*) ;;
  *) bad "verify does not run the tier script inside the guard: $verify_cmd" ;;
esac
case "$full_cmd" in
  *verify-guard*) bad "verify:full goes through the guard, so CI would take the shared lock: $full_cmd" ;;
esac
end

begin "the guard parses under every bash on the box"
expect_parses "$GUARD"
end

finish
