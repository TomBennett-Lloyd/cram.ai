#!/usr/bin/env bash
# Ends the processes left behind by worktrees that no longer exist, which hold the shared
# machine's load up and redden other lanes' verify runs on timeouts (#483). A process is an
# orphan when its cwd or its command line names <main>/.claude/worktrees/<name> and no entry
# <name> exists there any more. A worktree that still exists is reap-worktree.sh's to judge:
# "merged" also reads true of a branch just cut from main, with its lane running inside it.
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
consider() { # consider <pid> <reason>
  case "$protected" in *" $1 "*) return ;; esac
  case "$candidates" in *"<$1>"*) return ;; esac
  local line etime cmd age
  line=$(printf '%s\n' "$table" | awk -v p="$1" '$1 == p { print; exit }')
  [ -n "$line" ] || return # exited since the table was read
  read -r _ _ etime cmd <<EOF
$line
EOF
  age=$(age_minutes "$etime")
  [ "$age" -ge "$WORKTREE_ORPHAN_MIN_AGE_MINUTES" ] || return
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

if [ "$dry_run" = "1" ]; then
  printf 'orphans: would kill %d\n' "$count"
  exit 0
fi

alive() { kill -0 "$1" 2>/dev/null; }
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
