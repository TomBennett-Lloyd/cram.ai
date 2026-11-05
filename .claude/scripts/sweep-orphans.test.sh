#!/usr/bin/env bash
# Test harness for sweep-orphans.sh. Every process it parks names a path under its own
# `mktemp -d` tree, so the sweep under test can never select a process of the machine's.
#
# Usage: bash .claude/scripts/sweep-orphans.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
SUBJECT=${SWEEP_ORPHANS_SCRIPT:-$SCRIPTS/sweep-orphans.sh}

harness_init_tmp

bg_pids=""
# A stranded fixture is launchd's child, which reaps it the moment it exits and frees its pid, so
# its pid is signalled only while it still shows the harness's temp tree on its command line.
stranded_pids=""
harness_extra_cleanup() {
  for pid in $stranded_pids; do
    ps -ww -o command= -p "$pid" 2>/dev/null | grep -qF -- "$TMP_ROOT" && kill -KILL "$pid" 2>/dev/null
  done
  for pid in $bg_pids; do
    kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  done
}

# fixture <name> -> ROOT, a git repo at $ROOT/main whose worktree root W holds `live`, `x-y`
# and `a+b`, a name holding a character the reference grammar ends a name at.
fixture() {
  ROOT="$TMP_ROOT/$1"
  W="$ROOT/main/.claude/worktrees"
  must mkdir -p "$W/live" "$W/x-y" "$W/a+b"
  must git init --quiet -b main "$ROOT/main"
}

# Every parked process is a single process, never a shell with a `sleep` child: a child would hold the
# same cwd and be a second orphan, and would outlive the cleanup's kill holding the
# harness's stdout open.
#
# park_argv <text> -> PARKED, a process whose command line ends with <text>, once ps shows it.
park_argv() {
  perl -e 'sleep 60' -- "$1" &
  PARKED=$!
  bg_pids="$bg_pids $PARKED"
  await "ps -ww -o command= -p $PARKED | grep -qF -- \"\$1\"" "$1"
}

# park_cwd <dir> -> PARKED, a process whose cwd is <dir>, once lsof shows it.
park_cwd() {
  (cd "$1" && exec sleep 60) &
  PARKED=$!
  bg_pids="$bg_pids $PARKED"
  await "lsof -a -d cwd -p $PARKED -Fn | grep -qx \"n\$1\"" "$1"
}

# Polls for up to 30 s, because on a loaded machine a fork can take seconds to show in ps.
await() { # await <shell condition reading $1> <arg>
  for _ in $(seq 150); do
    bash -c "$1" _ "$2" 2>/dev/null && return 0
    sleep 0.2
  done
  printf 'FATAL harness could not observe a parked process: %s\n' "$2" >&2
  exit 2
}

alive() { kill -0 "$1" 2>/dev/null; }

sweep() { # sweep [--dry-run] — run from the fixture's main checkout, age guard off
  capture -C "$ROOT/main" env WORKTREE_ORPHAN_MIN_AGE_MINUTES=0 bash "$SUBJECT" "$@"
}

expect_listed() { expect_out "$1 $2 ("; }
expect_unlisted() { expect_not_out " $1 ("; }

# ==========================================================================================
begin "sweep-orphans.sh parses (bash -n)"
expect_parses "$SUBJECT"
end

# ==========================================================================================
begin "a dry run lists a gone worktree's cwd and argv holders and ends neither"
fixture dry
must mkdir "$W/gone-cwd"
park_cwd "$W/gone-cwd"
by_cwd=$PARKED
must rm -rf "$W/gone-cwd"
park_argv "$W/gone-argv/eval"
by_argv=$PARKED
park_cwd "$W/live"
in_live=$PARKED
must mkdir "$W/gone-both"
(cd "$W/gone-both" && exec perl -e 'sleep 60' "$W/gone-both") &
both=$!
bg_pids="$bg_pids $both"
await "ps -ww -o command= -p $both | grep -qF -- \"\$1\"" "$W/gone-both"
must rm -rf "$W/gone-both"
sweep --dry-run
expect_rc 0
expect_listed WOULD-KILL "$by_cwd"
expect_out "cwd in $W/gone-cwd)"
expect_listed WOULD-KILL "$by_argv"
expect_out "names $W/gone-argv)"
expect_unlisted "$in_live"
expect_listed WOULD-KILL "$both"
expect_out "orphans: would kill 3"
alive "$by_cwd" || bad "a dry run ended the cwd holder"
alive "$by_argv" || bad "a dry run ended the argv holder"
end

# ==========================================================================================
begin "a real run ends a gone worktree's holders and leaves a live one's"
fixture real
must mkdir "$W/gone-cwd"
park_cwd "$W/gone-cwd"
by_cwd=$PARKED
must rm -rf "$W/gone-cwd"
park_argv "$W/gone-argv"
by_argv=$PARKED
must mkdir "$W/live/packages"
park_cwd "$W/live/packages"
in_live=$PARKED
park_argv "$W/live"
names_live=$PARKED
perl -e '$SIG{TERM} = sub { open(my $f, ">", $ARGV[1]); print $f "term\n"; exit 0 }; sleep 60' \
  "$W/gone-term" "$ROOT/term.log" &
polite=$!
bg_pids="$bg_pids $polite"
await "ps -ww -o command= -p $polite | grep -qF -- \"\$1\"" "$W/gone-term"
sweep
expect_rc 0
expect_out "KILLED $by_cwd"
expect_out "KILLED $by_argv"
expect_out "KILLED $polite"
expect_out "orphans: killed 3"
grep -qx term "$ROOT/term.log" 2>/dev/null || bad "the orphan was not sent SIGTERM before SIGKILL"
alive "$by_cwd" && bad "the cwd holder of a gone worktree survived"
alive "$by_argv" && bad "the argv holder of a gone worktree survived"
alive "$in_live" || bad "a process in a live worktree was ended"
alive "$names_live" || bad "a process naming a live worktree was ended"
end

# ==========================================================================================
# The reference grammar: what follows "$W/" is a name, ended by any character no name holds,
# and it is live when the filesystem or the listing has it. Each row parks one process.
begin "each reference shape is judged by whether the worktree it names exists"
fixture grammar
# A listed row is `<text>|<the name the sweep reports>`.
listed_rows="
$W/x|x
$W/x/eval|x
$W/x-y-z|x-y-z
$W/x-y.old|x-y.old
$W/x-y_old|x-y_old
$W/x-y2|x-y2
$W/x-yZ|x-yZ
$W/x-yM|x-yM
$W/x-yz|x-yz
$W/Gone_2.b-c|Gone_2.b-c
$W/a|a
--dir=$W/gone|gone
:$W/gone|gone
$W/live $W/gone|gone
$W/gone $W/live|gone
$W/g1 $W/g2|g1
"
kept_rows="
$W/x-y
$W/x-y/eval
$W/live&&true
$W/live'
$W/live;
$W/live)
$W/
$W
${W}2/gone
/backup$W/gone
rel$W/gone
$W//gone
$W/..
$W/a+b
$W/a+b/eval
REL$W/gone
9$W/gone
.$W/gone
_$W/gone
-$W/gone
rel/$W/gone
"
listed_pids=""
kept_pids=""
while IFS= read -r row; do
  [ -n "$row" ] || continue
  park_argv "${row%|*}"
  listed_pids="$listed_pids $PARKED|${row##*|}"
done <<EOF
$listed_rows
EOF
while IFS= read -r row; do
  [ -n "$row" ] || continue
  park_argv "$row"
  kept_pids="$kept_pids $PARKED"
done <<EOF
$kept_rows
EOF
sweep --dry-run
expect_rc 0
for pair in $listed_pids; do expect_out "WOULD-KILL ${pair%|*} (0m, names $W/${pair#*|})"; done
for pid in $kept_pids; do expect_unlisted "$pid"; done
end

# ==========================================================================================
begin "a name that differs only in case is live on a case-insensitive volume"
fixture case
if [ -e "$W/LIVE" ]; then
  park_argv "$W/LIVE"
  upper=$PARKED
  sweep --dry-run
  expect_unlisted "$upper"
else
  printf '  (case-sensitive volume: the row does not arise)\n'
fi
end

# ==========================================================================================
begin "with no worktree root at all, every reference under it is an orphan"
fixture noroot
must rm -rf "$ROOT/main/.claude"
park_argv "$W/anything"
named=$PARKED
park_argv "$W/ $W/later"
later=$PARKED
sweep --dry-run
expect_rc 0
expect_listed WOULD-KILL "$named"
expect_out "WOULD-KILL $later (0m, names $W/later)"
end

# ==========================================================================================
begin "the sweep never ends its own ancestor, whatever that names"
fixture ancestor
cat >"$ROOT/wrapper.sh" <<'EOF'
bash "$1"
:
EOF
capture -C "$ROOT/main" env WORKTREE_ORPHAN_MIN_AGE_MINUTES=0 \
  bash "$ROOT/wrapper.sh" "$SUBJECT" "$W/gone-ancestor"
expect_rc 0
expect_not_out "gone-ancestor"
expect_out "orphans: killed 0"
end

# ==========================================================================================
begin "an orphan that ignores SIGTERM is ended by SIGKILL"
fixture stubborn
perl -e '$SIG{TERM} = "IGNORE"; sleep 1 while 1' "$W/gone-stubborn" &
stubborn=$!
disown "$stubborn" # its SIGKILL is the case's subject, not news for the harness's job table
bg_pids="$bg_pids $stubborn"
await "ps -ww -o command= -p $stubborn | grep -qF -- \"\$1\"" "$W/gone-stubborn"
sweep
expect_rc 0
expect_out "KILLED $stubborn"
alive "$stubborn" && bad "the TERM-ignoring orphan survived"
end

# ==========================================================================================
begin "an orphan whose live parent has not reaped it is ended, not a survivor"
fixture zombie
GZ="$W/gone-zombie" perl -e 'my $p = fork; if (!$p) { exec "perl", "-e", "sleep 60", "--", $ENV{GZ} } sleep 60' &
parent=$!
bg_pids="$bg_pids $parent"
child=""
for _ in $(seq 150); do
  child=$(ps -A -o pid= -o ppid= | awk -v p="$parent" '$2 == p { print $1; exit }')
  [ -n "$child" ] && ps -ww -o command= -p "$child" | grep -qF -- "$W/gone-zombie" && break
  sleep 0.2
done
[ -n "$child" ] || {
  printf 'FATAL harness could not observe the forked child\n' >&2
  exit 2
}
sweep
expect_rc 0
expect_out "KILLED $child"
expect_not_out "survived"
alive "$parent" || bad "the parent, which names no worktree, was ended"
end

# ==========================================================================================
# The age guard reads ps's etime, [[dd-]hh:]mm:ss. A ps wrapper rewrites one parked process's
# etime so each field's arm is reached; everything else is the real ps.
real_ps=$(command -v ps) || exit 2
must mkdir -p "$TMP_ROOT/stub"
cat >"$TMP_ROOT/stub/ps" <<EOF
#!/usr/bin/env bash
"$real_ps" "\$@" | sed "s/^\\( *\$FAKE_PID  *[0-9][0-9]*  *\\)[-0-9:][-0-9:]*/\\1\$FAKE_ETIME/"
EOF
must chmod +x "$TMP_ROOT/stub/ps"

aged_sweep() { # aged_sweep <etime> [min-age]  — min-age unset runs the shipped default
  if [ -n "${2:-}" ]; then
    capture -C "$ROOT/main" env PATH="$TMP_ROOT/stub:$PATH" FAKE_PID="$aged" FAKE_ETIME="$1" \
      WORKTREE_ORPHAN_MIN_AGE_MINUTES="$2" bash "$SUBJECT" --dry-run
  else
    capture -C "$ROOT/main" env -u WORKTREE_ORPHAN_MIN_AGE_MINUTES PATH="$TMP_ROOT/stub:$PATH" \
      FAKE_PID="$aged" FAKE_ETIME="$1" bash "$SUBJECT" --dry-run
  fi
}

begin "the age guard reads every etime field and admits at the minimum, not under it"
fixture aged
park_argv "$W/gone-aged"
aged=$PARKED
for row in "09:59|-|kept" "10:00|-|listed" "08:00|8|listed" "07:59|8|kept" \
  "01:00:00|60|listed" "00:59:59|60|kept" "02:00:00|121|kept" \
  "1-00:00:00|1440|listed" "1-00:00:00|1441|kept" "2-01:30:00|2970|listed"; do
  etime=${row%%|*}
  rest=${row#*|}
  min=${rest%%|*}
  want=${rest#*|}
  case_ctx="etime $etime, min-age $min"
  if [ "$min" = "-" ]; then aged_sweep "$etime"; else aged_sweep "$etime" "$min"; fi
  if [ "$want" = "listed" ]; then expect_listed WOULD-KILL "$aged"; else expect_unlisted "$aged"; fi
done
case_ctx=""
end

# ==========================================================================================
begin "a process table or cwd listing it cannot read is no verdict, not an empty sweep"
fixture blind
must mkdir -p "$TMP_ROOT/blind-ps" "$TMP_ROOT/blind-lsof"
printf '#!/usr/bin/env bash\nexit 1\n' >"$TMP_ROOT/blind-ps/ps"
printf '#!/usr/bin/env bash\nexit 1\n' >"$TMP_ROOT/blind-lsof/lsof"
must chmod +x "$TMP_ROOT/blind-ps/ps" "$TMP_ROOT/blind-lsof/lsof"
for tool in ps lsof; do
  case_ctx="failing $tool"
  capture -C "$ROOT/main" env PATH="$TMP_ROOT/blind-$tool:$PATH" bash "$SUBJECT" --dry-run
  expect_rc 2
done
case_ctx=""
end

# ==========================================================================================
# A ps wrapper that leaves out one row stands for a process that started after the table was
# read: lsof then names a pid the table lacks.
begin "a cwd holder missing from the process table is not a candidate"
fixture unlisted
must mkdir "$W/gone-unlisted" "$TMP_ROOT/drop"
park_cwd "$W/gone-unlisted"
unlisted=$PARKED
must rm -rf "$W/gone-unlisted"
cat >"$TMP_ROOT/drop/ps" <<EOF
#!/usr/bin/env bash
"$real_ps" "\$@" | awk -v p="\$FAKE_DROP" '\$1 != p'
EOF
must chmod +x "$TMP_ROOT/drop/ps"
capture -C "$ROOT/main" env PATH="$TMP_ROOT/drop:$PATH" FAKE_DROP="$unlisted" \
  WORKTREE_ORPHAN_MIN_AGE_MINUTES=0 bash "$SUBJECT" --dry-run
expect_rc 0
expect_unlisted "$unlisted"
expect_out "orphans: would kill 0"
end

# ==========================================================================================
# The stranded arm judges a process whose parent is pid 1. A real one is made by a double fork:
# the first perl forks and exits, so the child is re-parented to pid 1 and execs the same
# single-process `sleep` park_argv uses. Its stdio is closed so it holds nothing of the harness's.
#
# park_stranded <argv text> [cwd] -> PARKED, a process with ppid 1 whose command line ends with
# <argv text> and whose cwd is [cwd] when given, once ps shows both. With LISTEN=1 it also holds a
# listening socket on the loopback interface.
park_stranded() {
  local pidfile="$TMP_ROOT/stranded.$RANDOM.pid"
  perl -e 'exit 0 if fork; chdir($ARGV[2]) if length $ARGV[2];
    open(STDIN, "<", "/dev/null"); open(STDOUT, ">", "/dev/null"); open(STDERR, ">", "/dev/null");
    open(my $f, ">", "$ARGV[1].tmp"); print $f $$; close $f; rename "$ARGV[1].tmp", $ARGV[1];
    if ($ENV{LISTEN}) { exec "perl", "-e", "use IO::Socket::INET; our \$s = IO::Socket::INET->new(Listen => 1, LocalAddr => q(127.0.0.1), LocalPort => 0) or die; sleep 60", "--", $ARGV[0] }
    exec "perl", "-e", "sleep 60", "--", $ARGV[0]' -- "$1" "$pidfile" "${2:-}"
  await "[ -s \"\$1\" ]" "$pidfile"
  PARKED=$(cat "$pidfile")
  stranded_pids="$stranded_pids $PARKED"
  await "[ \"\$(ps -o ppid= -p $PARKED | tr -d ' ')\" = 1 ] && ps -ww -o command= -p $PARKED | grep -qF -- \"\$1\"" "$1"
  [ -z "${LISTEN:-}" ] || await "lsof -a -p $PARKED -iTCP -sTCP:LISTEN -t | grep -q ." "$1"
}

stranded_sweep() { # stranded_sweep <pid> <etime> [bound] — <pid> reads <etime>; no bound runs the default
  if [ -n "${3:-}" ]; then
    capture -C "$ROOT/main" env PATH="$TMP_ROOT/stub:$PATH" FAKE_PID="$1" FAKE_ETIME="$2" \
      WORKTREE_STRANDED_MIN_AGE_MINUTES="$3" bash "$SUBJECT" --dry-run
  else
    capture -C "$ROOT/main" env -u WORKTREE_STRANDED_MIN_AGE_MINUTES PATH="$TMP_ROOT/stub:$PATH" \
      FAKE_PID="$1" FAKE_ETIME="$2" bash "$SUBJECT" --dry-run
  fi
}

# ==========================================================================================
begin "a dry run lists a process stranded under a live worktree, apart from the vanished arm"
fixture stranded
park_stranded "$W/live/eval"
by_argv=$PARKED
park_stranded "$ROOT/plain-cwd" "$W/live"
by_cwd=$PARKED
park_argv "$W/live/eval"
has_parent=$PARKED
park_stranded "$ROOT/main/.claude/elsewhere"
outside_root=$PARKED
LISTEN=1 park_stranded "$W/live/server"
server=$PARKED
LISTEN=1 park_stranded "$ROOT/plain-server" "$W/live"
server_cwd=$PARKED
park_stranded "$W/../elsewhere"
dotdot=$PARKED
park_stranded "$W/./foo"
dot=$PARKED
must touch "$W/stray-file" "$W/a+stray"
park_stranded "$W/stray-file/x"
stray=$PARKED
park_stranded "$W/a+stray"
stray_plus=$PARKED
park_stranded "${W}2/live"
sibling_dir=$PARKED
park_stranded "$W/"
bare_root=$PARKED
park_stranded "$W/live/x $W/gone-also"
gone_too=$PARKED
park_stranded "$W/a+b/eval"
plus_name=$PARKED
park_stranded "rel$W/live"
glued=$PARKED
park_stranded "rel$W/live $W/live/eval"
glued_then_real=$PARKED
park_stranded "$W/ $W/live/eval"
bare_then_real=$PARKED
capture -C "$ROOT/main" env WORKTREE_ORPHAN_MIN_AGE_MINUTES=0 WORKTREE_STRANDED_MIN_AGE_MINUTES=0 \
  bash "$SUBJECT" --dry-run
expect_rc 0
expect_out "WOULD-KILL $by_argv (0m, ppid 1 under live $W/live)"
expect_out "WOULD-KILL $by_cwd (0m, ppid 1 under live $W/live)"
expect_unlisted "$has_parent"
expect_unlisted "$outside_root"
expect_unlisted "$sibling_dir"
expect_unlisted "$bare_root"
expect_unlisted "$server"
expect_unlisted "$server_cwd"
expect_unlisted "$dotdot"
expect_unlisted "$dot"
expect_unlisted "$stray"
expect_unlisted "$stray_plus"
expect_unlisted "$glued"
expect_out "WOULD-KILL $glued_then_real (0m, ppid 1 under live $W/live)"
expect_out "WOULD-KILL $bare_then_real (0m, ppid 1 under live $W/live)"
expect_out "WOULD-KILL $plus_name (0m, ppid 1 under live $W/a+b)"
expect_out "WOULD-KILL $gone_too (0m, names $W/gone-also)"
expect_not_out "WOULD-KILL $gone_too (0m, ppid 1"
expect_out "orphans: would kill 6"
alive "$by_argv" || bad "a dry run ended the stranded argv holder"
alive "$by_cwd" || bad "a dry run ended the stranded cwd holder"
end

# ==========================================================================================
begin "a real run ends a stranded process and leaves a live parent's child and a bystander"
fixture strandedreal
park_stranded "$W/live/eval"
by_argv=$PARKED
park_stranded "$ROOT/plain-cwd" "$W/live"
by_cwd=$PARKED
park_argv "$W/live/eval"
has_parent=$PARKED
park_stranded "$ROOT/main/.claude/elsewhere"
outside_root=$PARKED
capture -C "$ROOT/main" env WORKTREE_ORPHAN_MIN_AGE_MINUTES=0 WORKTREE_STRANDED_MIN_AGE_MINUTES=0 \
  bash "$SUBJECT"
expect_rc 0
expect_out "KILLED $by_argv"
expect_out "KILLED $by_cwd"
expect_out "orphans: killed 2"
alive "$by_argv" && bad "the stranded argv holder survived"
alive "$by_cwd" && bad "the stranded cwd holder survived"
alive "$has_parent" || bad "a process with a living parent under a live worktree was ended"
alive "$outside_root" || bad "a ppid-1 process naming no worktree was ended"
end

# ==========================================================================================
begin "the stranded bound admits a ppid-1 process at its age, not under it"
fixture strandedaged
park_stranded "$W/live/eval"
stranded=$PARKED
park_argv "$W/live/eval"
has_parent=$PARKED
for row in "59:59|60|kept" "01:00:00|60|listed" "01:00:01|60|listed" "00:00|1|kept" "01:00|1|listed" \
  "23:59:59|1440|kept" "1-00:00:00|1440|listed"; do
  etime=${row%%|*}
  rest=${row#*|}
  want=${rest#*|}
  case_ctx="etime $etime, bound ${rest%%|*}"
  stranded_sweep "$stranded" "$etime" "${rest%%|*}"
  expect_rc 0
  if [ "$want" = "listed" ]; then expect_listed WOULD-KILL "$stranded"; else expect_unlisted "$stranded"; fi
done
case_ctx="a living parent, however old"
stranded_sweep "$has_parent" "9-00:00:00" 60
expect_unlisted "$has_parent"
case_ctx=""
end

# ==========================================================================================
begin "the shipped stranded bound is the one the script declares, and admits at it"
fixture strandeddefault
park_stranded "$W/live/eval"
stranded=$PARKED
default=$(sed -n 's/^: "[$]{WORKTREE_STRANDED_MIN_AGE_MINUTES:=\([0-9][0-9]*\)}".*/\1/p' "$SUBJECT")
case "$default" in
  '' | *[!0-9]* | 0) bad "the script declares no positive stranded bound: '$default'" ;;
  *)
    case_ctx="the default bound, at it"
    stranded_sweep "$stranded" "$(printf '%02d:%02d:00' $((default / 60)) $((default % 60)))"
    expect_listed WOULD-KILL "$stranded"
    case_ctx="the default bound, a second under it"
    stranded_sweep "$stranded" "$(printf '%02d:%02d:59' $(((default - 1) / 60)) $(((default - 1) % 60)))"
    expect_unlisted "$stranded"
    case_ctx=""
    ;;
esac
end

# ==========================================================================================
# A ps wrapper rewrites one process's parent column, so the arm's reading of it is exact: pid 1
# and no other pid, whatever digits follow.
begin "the stranded arm reads the parent from the process table: exactly pid 1"
fixture strandedppid
must mkdir -p "$TMP_ROOT/ppid-stub"
cat >"$TMP_ROOT/ppid-stub/ps" <<EOF
#!/usr/bin/env bash
"$real_ps" "\$@" | sed "s/^\\( *\$FAKE_PID  *\\)[0-9][0-9]*/\\1\$FAKE_PPID/"
EOF
must chmod +x "$TMP_ROOT/ppid-stub/ps"
park_stranded "$W/live/eval"
stranded=$PARKED
park_argv "$W/live/eval"
has_parent=$PARKED
ppid_sweep() { # ppid_sweep <pid> <ppid>
  capture -C "$ROOT/main" env PATH="$TMP_ROOT/ppid-stub:$PATH" FAKE_PID="$1" FAKE_PPID="$2" \
    WORKTREE_STRANDED_MIN_AGE_MINUTES=0 bash "$SUBJECT" --dry-run
}
for fake in 0 2 10 11 100 21 1000; do
  case_ctx="parent read as $fake"
  ppid_sweep "$stranded" "$fake"
  expect_unlisted "$stranded"
done
case_ctx="a parent read as 1"
ppid_sweep "$stranded" 1
expect_listed WOULD-KILL "$stranded"
ppid_sweep "$has_parent" 1
expect_listed WOULD-KILL "$has_parent"
case_ctx=""
end

# ==========================================================================================
begin "a name that differs only in case is live to the stranded arm on a case-insensitive volume"
fixture strandedcase
if [ -e "$W/LIVE" ]; then
  park_stranded "$W/LIVE/eval"
  upper=$PARKED
  capture -C "$ROOT/main" env WORKTREE_STRANDED_MIN_AGE_MINUTES=0 bash "$SUBJECT" --dry-run
  expect_listed WOULD-KILL "$upper"
else
  printf '  (case-sensitive volume: the row does not arise)\n'
fi
end

finish
