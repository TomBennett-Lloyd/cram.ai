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
harness_extra_cleanup() {
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

# Every parked process is one perl, never a shell with a `sleep` child: a child would hold the
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

finish
