#!/usr/bin/env bash
# Ends the processes left behind under <main>/.claude/worktrees, which hold the shared
# machine's load up and redden other lanes' verify runs on timeouts (#483). A process is an
# orphan by either of two arms, each judged on its cwd or its command line naming
# <main>/.claude/worktrees/<name>:
#   vanished  no entry <name> exists there any more (older than WORKTREE_ORPHAN_MIN_AGE_MINUTES);
#   stranded  <name> still exists, but the process's parent is pid 1, so whatever launched it
#             is gone, and it is older than WORKTREE_STRANDED_MIN_AGE_MINUTES (#654: a hook
#             blocked on a stdin pipe nobody closed). A live lane's processes always have a
#             living parent, so ppid 1 is what separates a leak from a workload.
# A process under a live worktree with a living parent is never a candidate; the worktree
# itself is reap-worktree.sh's to judge. A process naming no worktree path is not this
# script's business, whatever its parent.
#
# Usage: sweep-orphans.sh [--dry-run]   (finds the repo from the cwd; sweep-worktrees.sh runs it)
# Exit:  0 the sweep ran (finding nothing is a normal outcome), 2 unexpected failure, or an
#        orphan that outlived SIGKILL.
set -u
export PATH="/opt/homebrew/bin:$PATH"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./worktree-lib.sh
. "$script_dir/worktree-lib.sh"

# A younger process may name a worktree that is being created: `git worktree add <path>` runs
# before <path> exists. 0 disables the guard.
: "${WORKTREE_ORPHAN_MIN_AGE_MINUTES:=10}"
# The stranded arm's bound, and the one place its figure is declared: a just-detached child
# of a live lane is re-parented to pid 1 for a moment, and a leak is hours old.
: "${WORKTREE_STRANDED_MIN_AGE_MINUTES:=180}"

usage() {
  echo "usage: sweep-orphans.sh [--dry-run]" >&2
  exit 2
}

dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    *) usage ;;
  esac
  shift
done

main_dir=$(main_checkout_dir "$PWD") || {
  echo "sweep-orphans.sh must run inside a git worktree" >&2
  exit 2
}
main_dir=$(canon "$main_dir") || exit 2
root="$main_dir/.claude/worktrees"

entries=""
if [ -d "$root" ]; then
  entries=$(ls -A "$root") || exit 2
fi

# names_live <rest> -> 0 when <rest>, the text after "$root/", starts with an existing entry's
# name followed by a character no worktree name holds. Ambiguity resolves to live: the
# boundary is judged against the names that exist, so `x&&cmd` is x's and `x-y` is not x's.
names_live() {
  local e
  while IFS= read -r e; do
    [ -n "$e" ] || continue
    case "$1" in
      "$e" | "$e"[!A-Za-z0-9._-]*) return 0 ;;
    esac
  done <<EOF
$entries
EOF
  return 1
}

# gone_name <text> -> the first worktree name <text> refers to that no longer exists, or
# nothing. A reference is "$root/" not preceded by a path character, then a name character.
# The filesystem is asked as well as the listing, so a case-insensitive volume's `LIVE` is live.
gone_name() {
  local s=$1 before rest prev name
  while :; do
    case "$s" in
      *"$root/"*) ;;
      *) return 0 ;;
    esac
    before=${s%%"$root/"*}
    rest=${s#*"$root/"}
    prev=${before: -1}
    case "$prev" in
      [A-Za-z0-9._/-]) ;;
      *)
        name=${rest%%[!A-Za-z0-9._-]*}
        if [ -n "$name" ] && [ ! -e "$root/$name" ] && ! names_live "$rest"; then
          printf '%s\n' "$name"
          return 0
        fi
        ;;
    esac
    s=$rest
  done
}

# live_name <text> -> the name of the first reference in <text> to a worktree that exists,
# or nothing; the reference grammar is gone_name's.
live_name() {
  local s=$1 before rest prev name e
  while :; do
    case "$s" in
      *"$root/"*) ;;
      *) return 0 ;;
    esac
    before=${s%%"$root/"*}
    rest=${s#*"$root/"}
    prev=${before: -1}
    case "$prev" in
      [A-Za-z0-9._/-]) ;;
      *)
        name=${rest%%[!A-Za-z0-9._-]*}
        if [ -n "$name" ] && [ -e "$root/$name" ]; then
          printf '%s\n' "$name"
          return 0
        fi
        while IFS= read -r e; do
          [ -n "$e" ] || continue
          case "$rest" in
            "$e" | "$e"[!A-Za-z0-9._-]*)
              printf '%s\n' "$e"
              return 0
              ;;
          esac
        done <<EOF
$entries
EOF
        ;;
    esac
    s=$rest
  done
}

age_minutes() { # age_minutes <ps etime: [[dd-]hh:]mm:ss>
  local t=$1 d=0 h=0
  case "$t" in *-*) d=${t%%-*} t=${t#*-} ;; esac
  case "$t" in *:*:*) h=${t%%:*} t=${t#*:} ;; esac
  echo $((10#$d * 1440 + 10#$h * 60 + 10#${t%%:*}))
}

uid=$(id -u) || exit 2
table=$(ps -ww -U "$uid" -o pid= -o ppid= -o etime= -o command=) || exit 2
cwds=$(lsof -a -d cwd -u "$uid" -Fpn 2>/dev/null | awk '/^p/ { p = substr($0, 2) } /^n/ { print p " " substr($0, 2) }')
[ -n "$cwds" ] || {
  echo "sweep-orphans.sh: lsof listed no process cwd for uid $uid" >&2
  exit 2
}

# The sweep's own ancestors are never candidates: the shell that ran it may name the worktree
# it has just reaped (`reap-worktree.sh <path> && sweep-worktrees.sh`).
protected=" "
pid=$$
while [ "$pid" -gt 1 ]; do
  pid=$(printf '%s\n' "$table" | awk -v p="$pid" '$1 == p { print $2; exit }')
  [ -n "$pid" ] || break
  protected="$protected$pid "
done

candidates=""
consider() { # consider <pid> <reason> [min age in minutes; default the vanished arm's]
  case "$protected" in *" $1 "*) return ;; esac
  case "$candidates" in *"<$1>"*) return ;; esac
  local line etime cmd age
  line=$(printf '%s\n' "$table" | awk -v p="$1" '$1 == p { print; exit }')
  [ -n "$line" ] || return # exited since the table was read
  read -r _ _ etime cmd <<EOF
$line
EOF
  age=$(age_minutes "$etime")
  [ "$age" -ge "${3:-$WORKTREE_ORPHAN_MIN_AGE_MINUTES}" ] || return
  candidates="$candidates<$1>"
  orphan_pids="$orphan_pids $1"
  count=$((count + 1))
  printf '%s %s (%sm, %s) %.160s\n' "$label" "$1" "$age" "$2" "$cmd"
}

if [ "$dry_run" = "1" ]; then label="WOULD-KILL"; else label="ORPHAN"; fi
orphan_pids=""
count=0
while read -r pid path; do
  name=$(gone_name "$path")
  [ -n "$name" ] && consider "$pid" "cwd in $root/$name"
done <<EOF
$(printf '%s\n' "$cwds" | grep -F "$root/")
EOF
while read -r pid _ _ cmd; do
  name=$(gone_name "$cmd")
  [ -n "$name" ] && consider "$pid" "names $root/$name"
done <<EOF
$(printf '%s\n' "$table" | grep -F "$root/")
EOF

# The stranded arm: <text> references a live worktree and the process's parent is pid 1.
consider_stranded() { # consider_stranded <pid> <text>
  local name ppid
  name=$(live_name "$2")
  [ -n "$name" ] || return
  ppid=$(printf '%s\n' "$table" | awk -v p="$1" '$1 == p { print $2; exit }')
  [ "$ppid" = "1" ] || return
  consider "$1" "ppid 1 under live $root/$name" "$WORKTREE_STRANDED_MIN_AGE_MINUTES"
}
while read -r pid path; do
  consider_stranded "$pid" "$path"
done <<EOF
$(printf '%s\n' "$cwds" | grep -F "$root/")
EOF
while read -r pid _ _ cmd; do
  consider_stranded "$pid" "$cmd"
done <<EOF
$(printf '%s\n' "$table" | grep -F "$root/")
EOF

if [ "$dry_run" = "1" ]; then
  printf 'orphans: would kill %d\n' "$count"
  exit 0
fi

# A zombie answers `kill -0` but has ended: its parent reaps it on the parent's own schedule.
alive() {
  local stat
  stat=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
  case "$stat" in *Z*) return 1 ;; esac
}
for pid in $orphan_pids; do kill -TERM "$pid" 2>/dev/null; done
for _ in $(seq 25); do
  left=""
  for pid in $orphan_pids; do alive "$pid" && left="$left $pid"; done
  [ -n "$left" ] || break
  sleep 0.2
done
for pid in $left; do kill -KILL "$pid" 2>/dev/null; done
[ -n "$left" ] && sleep 0.5

killed=0
failed=0
for pid in $orphan_pids; do
  if alive "$pid"; then
    printf 'ERROR orphan %s survived SIGKILL\n' "$pid" >&2
    failed=$((failed + 1))
  else
    printf 'KILLED %s\n' "$pid"
    killed=$((killed + 1))
  fi
done
if [ "$failed" -gt 0 ]; then
  printf 'orphans: killed %d, failed %d\n' "$killed" "$failed"
  exit 2
fi
printf 'orphans: killed %d\n' "$killed"
