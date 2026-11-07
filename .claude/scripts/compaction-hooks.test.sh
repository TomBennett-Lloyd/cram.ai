#!/usr/bin/env bash
#
# Test harness for the two compaction hooks and their library (#629):
#
#   .claude/hooks/pre-compact-snapshot.sh   PreCompact: writes the repo-state snapshot
#   .claude/hooks/post-compact-reinject.sh  SessionStart `compact`: puts it back in context
#   .claude/hooks/compaction-lib.sh         what both share
#
# WHAT IS ASSERTED, and the oracle for each claim. The state block is judged against `git`
# itself, run on the fixture by this harness (`git status --short`, `git log --oneline
# origin/main..HEAD`, `git rev-parse --git-path`), never against the lib's own parsing. The
# registration is judged by parsing .claude/settings.json. "Never blocks" is rc 0 on every
# case, including each broken-input shape: PreCompact's exit 2 would BLOCK a compaction, and
# a lane that cannot compact at its window is the failure the hooks exist to prevent.
#
# WHAT IS NOT ASSERTED HERE: that Claude Code fires either event inside a subagent, or what
# a compacted subagent receives. That is a property of the platform, not of these scripts, and
# it is established by a live run, not a fixture (#629's empirical item).
#
# Every fixture is a throwaway git repo under one mktemp tree, with a linked worktree on an
# issue-shaped branch, as the lanes run. No network.
#
# Usage: bash .claude/scripts/compaction-hooks.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
HOOKS=$(cd "$SCRIPTS/../hooks" && pwd) || exit 2
SETTINGS="$SCRIPTS/../settings.json"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

PRE_HOOK=${PRE_HOOK:-$HOOKS/pre-compact-snapshot.sh}
POST_HOOK=${POST_HOOK:-$HOOKS/post-compact-reinject.sh}

for tool in git node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "compaction-hooks.test.sh: $tool is not installed — refusing to report a pass" >&2
    exit 2
  fi
done

harness_init_tmp

# --- fixtures -------------------------------------------------------------------------

# make_lane <name> <branch> <commits-ahead> <untracked-files> -> $TMP_ROOT/<name>/main with a
# linked worktree at .claude/worktrees/lane on <branch>, <commits-ahead> commits past an
# origin/main ref, and <untracked-files> untracked files `u01.txt`… in the worktree.
make_lane() {
  local base="$TMP_ROOT/$1" i
  must mkdir -p "$base"
  must git init -q -b main "$base/main"
  must git -C "$base/main" config user.email "harness@example.invalid"
  must git -C "$base/main" config user.name "Harness"
  must git -C "$base/main" config commit.gpgsign false
  must git -C "$base/main" commit -q --allow-empty -m seed
  must git -C "$base/main" update-ref refs/remotes/origin/main HEAD
  # The branch `main` cannot be checked out twice, so that one case runs in the main
  # checkout itself and lane_wt answers with it.
  if [ "$2" != "main" ]; then
    must mkdir -p "$base/main/.claude/worktrees"
    must git -C "$base/main" worktree add -q -b "$2" "$base/main/.claude/worktrees/lane"
  fi
  for ((i = 1; i <= $3; i++)); do
    must git -C "$(lane_wt "$1")" commit -q --allow-empty -m "$(printf 'step %02d' "$i")"
  done
  for ((i = 1; i <= $4; i++)); do
    must touch "$(lane_wt "$1")/$(printf 'u%02d.txt' "$i")"
  done
}

lane_wt() {
  if [ -d "$TMP_ROOT/$1/main/.claude/worktrees/lane" ]; then
    printf '%s' "$TMP_ROOT/$1/main/.claude/worktrees/lane"
  else
    printf '%s' "$TMP_ROOT/$1/main"
  fi
}

# state_file <name> <key> -> where the snapshot for that agent key lives, asked of git.
state_file() {
  git -C "$(lane_wt "$1")" rev-parse --path-format=absolute --git-path "cram-compaction-snapshot.$2"
}

# --- invocation: the event goes to a file and is REDIRECTED INTO capture (harness-lib) ---

run_hook() { # run_hook <hook> <event-json> [ENV=VAL...]
  local hook="$1" json="$2"
  shift 2
  must printf '%s' "$json" >"$TMP_ROOT/event.json"
  capture env "$@" bash "$hook" <"$TMP_ROOT/event.json"
}

event() { # event <cwd> [extra-json-fields-with-leading-comma]
  printf '{"cwd":"%s"%s}' "$1" "${2:-}"
}

# age_file <file> <minutes> -> set its mtime that many minutes into the past. node, not
# touch(1): `touch -t` and `touch -d` differ between BSD and GNU.
age_file() {
  must node -e 'const t=(Date.now()-Number(process.argv[2])*60000)/1000;require("fs").utimesSync(process.argv[1],t,t)' "$1" "$2"
}

contains() { # contains <haystack> <needle>
  case "$1" in *"$2"*) return 0 ;; esac
  return 1
}

# --- registration ---------------------------------------------------------------------

# Each call parses settings.json and prints the commands for one event and matcher, so each case
# below compares against what settings.json says rather than against this file's belief.
registered() { # registered <event> <matcher-or-"-"> -> the hook command, or nothing
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const [event, matcher] = [process.argv[2], process.argv[3]];
    for (const g of (s.hooks && s.hooks[event]) || []) {
      if ((matcher === "-" ? g.matcher === undefined : g.matcher === matcher)) {
        for (const h of g.hooks) { console.log(h.command); }
      }
    }' "$SETTINGS" "$1" "$2"
}

begin "settings.json registers PreCompact to the snapshot hook, for every trigger"
cmd=$(registered PreCompact -)
case "$cmd" in
  *'/.claude/hooks/pre-compact-snapshot.sh') ;;
  *) bad "PreCompact command is not the snapshot hook; got: $cmd" ;;
esac
[ -x "$HOOKS/pre-compact-snapshot.sh" ] || bad "pre-compact-snapshot.sh is not executable"
end

begin "settings.json registers SessionStart matcher 'compact' to the re-injection hook"
cmd=$(registered SessionStart compact)
case "$cmd" in
  *'/.claude/hooks/post-compact-reinject.sh') ;;
  *) bad "SessionStart compact command is not the re-injection hook; got: $cmd" ;;
esac
[ -x "$HOOKS/post-compact-reinject.sh" ] || bad "post-compact-reinject.sh is not executable"
end

begin "settings.json keeps the deps hook on SessionStart, unmatched, beside the new one"
cmd=$(registered SessionStart -)
case "$cmd" in
  *'/.claude/hooks/ensure-deps.sh') ;;
  *) bad "the unmatched SessionStart entry is not ensure-deps; got: $cmd" ;;
esac
end

# --- PreCompact: the snapshot ----------------------------------------------------------

make_lane snap 629-lane 3 2
SNAP_WT=$(lane_wt snap)
must touch "$SNAP_WT/a b.txt"
must printf 'SLIDE-TEXT-MARKER-7731' >"$SNAP_WT/u01.txt"

begin "pre-compact writes the snapshot into the git directory, silently, exit 0"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT" ',"trigger":"auto","custom_instructions":null')"
expect_rc 0 "$rc"
expect_silent
f=$(state_file snap main)
[ -f "$f" ] || bad "no snapshot at $f"
case "$f" in
  "$SNAP_WT"/*) bad "snapshot is inside the work tree: $f" ;;
esac
end

begin "the snapshot names the trigger, branch, issue, worktree and cwd"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
for want in "trigger: auto" "branch: 629-lane" "issue: #629" "worktree: $SNAP_WT" "cwd: $SNAP_WT"; do
  contains "$snap" "$want" || bad "snapshot lacks '$want'; got: $snap"
done
end

begin "the snapshot's log and status are what git itself prints for the fixture"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
oracle_log=$(git -C "$SNAP_WT" log --oneline origin/main..HEAD)
oracle_status=$(git -C "$SNAP_WT" status --short)
contains "$snap" "$oracle_log" || bad "git log oracle not in snapshot; oracle: $oracle_log"
contains "$snap" "$oracle_status" || bad "git status oracle not in snapshot; oracle: $oracle_status"
contains "$snap" "commits ahead of origin/main: 3 " || bad "ahead count missing; got: $snap"
end

begin "the snapshot names a path with a space and never reads file content"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
contains "$snap" "a b.txt" || bad "path with a space missing; got: $snap"
contains "$snap" "u01.txt" || bad "untracked path missing; got: $snap"
contains "$snap" "SLIDE-TEXT-MARKER-7731" && bad "file content reached the snapshot"
end

begin "the snapshot file is invisible to the git status it reports"
st=$(git -C "$SNAP_WT" status --short)
contains "$st" "cram-compaction-snapshot" && bad "snapshot shows in git status: $st"
end

begin "trigger manual is recorded, and agent_type lands in the snapshot"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT" ',"trigger":"manual","agent_type":"ticket-agent"')"
expect_rc 0 "$rc"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
contains "$snap" "trigger: manual" || bad "manual trigger missing; got: $snap"
contains "$snap" "agent_type: ticket-agent" || bad "agent_type missing; got: $snap"
end

begin "a missing trigger is recorded as unknown, never blank"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT")"
expect_rc 0 "$rc"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
contains "$snap" "trigger: unknown" || bad "unknown trigger missing; got: $snap"
end

begin "a subagent's snapshot is keyed by its id, reduced to [A-Za-z0-9_-]"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT" ',"trigger":"auto","agent_id":"a1/../b2"')"
expect_rc 0 "$rc"
[ -f "$(state_file snap a1b2)" ] || bad "no snapshot keyed a1b2"
end

begin "a repository with no origin/main ref still snapshots, stating the count unknown"
make_lane noref 629-lane 0 0
must git -C "$(lane_wt noref)" update-ref -d refs/remotes/origin/main
run_hook "$PRE_HOOK" "$(event "$(lane_wt noref)" ',"trigger":"auto"')"
expect_rc 0 "$rc"
snap=$(cat "$(state_file noref main)" 2>/dev/null)
contains "$snap" "commits ahead of origin/main: unknown" || bad "unknown count missing; got: $snap"
end

begin "pre-compact writes nothing on main, silently: only a lane is snapshot"
make_lane onmain main 0 0
run_hook "$PRE_HOOK" "$(event "$TMP_ROOT/onmain/main" ',"trigger":"auto","agent_id":"abc123"')"
expect_rc 0 "$rc"
expect_silent
[ -e "$(git -C "$TMP_ROOT/onmain/main" rev-parse --path-format=absolute --git-path cram-compaction-snapshot.abc123)" ] && bad "a snapshot was written on main"
end

begin "a snapshot of an agent id holding a dash and an underscore keeps both"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT" ',"trigger":"auto","agent_id":"a-b_c"')"
[ -f "$(state_file snap a-b_c)" ] || bad "no snapshot keyed a-b_c"
end

begin "no agent_type line when the event carries none, and no history before origin/main"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT" ',"trigger":"auto"')"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
contains "$snap" "agent_type:" && bad "an agent_type line with no agent_type; got: $snap"
contains "$snap" "seed" && bad "history before origin/main reached the snapshot; got: $snap"
end

begin "cwd is the event's directory and worktree is the tree's root"
must mkdir -p "$SNAP_WT/sub"
run_hook "$PRE_HOOK" "$(event "$SNAP_WT/sub" ',"trigger":"auto"')"
expect_rc 0 "$rc"
snap=$(cat "$(state_file snap main)" 2>/dev/null)
contains "$snap" "cwd: $SNAP_WT/sub" || bad "cwd line is not the event's; got: $snap"
contains "$snap" "worktree: $SNAP_WT"$'\n' || bad "worktree line is not the root; got: $snap"
end

begin "pre-compact writes nothing on a plain detached HEAD"
make_lane detpre 629-lane 0 0
must git -C "$(lane_wt detpre)" checkout -q --detach
run_hook "$PRE_HOOK" "$(event "$(lane_wt detpre)" ',"trigger":"auto"')"
expect_rc 0 "$rc"
expect_silent
[ -e "$(state_file detpre main)" ] && bad "a snapshot was written on a detached HEAD"
end

# The caps, at their boundary: 40 fits, 41 is cut to 40 and says so.
make_lane cap40 629-lane 40 40
make_lane cap41 629-lane 41 41

begin "40 commits and 40 paths are all shown"
run_hook "$PRE_HOOK" "$(event "$(lane_wt cap40)" ',"trigger":"auto"')"
snap=$(cat "$(state_file cap40 main)" 2>/dev/null)
contains "$snap" "commits ahead of origin/main: 40 (git log --oneline origin/main..HEAD, newest first, showing 40)" || bad "40-commit header wrong; got: $snap"
contains "$snap" "40 changed paths, showing 40" || bad "40-path header wrong"
contains "$snap" "u40.txt" || bad "the 40th path was cut"
contains "$snap" "step 01" || bad "the oldest of 40 commits was cut"
end

begin "41 commits and 41 paths are cut to 40, newest first, and the header says so"
run_hook "$PRE_HOOK" "$(event "$(lane_wt cap41)" ',"trigger":"auto"')"
snap=$(cat "$(state_file cap41 main)" 2>/dev/null)
contains "$snap" "commits ahead of origin/main: 41 (git log --oneline origin/main..HEAD, newest first, showing 40)" || bad "41-commit header wrong; got: $snap"
contains "$snap" "41 changed paths, showing 40" || bad "41-path header wrong"
contains "$snap" "step 41" || bad "the newest commit was cut"
contains "$snap" "step 01" && bad "the 41st (oldest) commit was shown"
contains "$snap" "u41.txt" && bad "the 41st path was shown"
end

# --- SessionStart compact: the re-injection ---------------------------------------------

make_lane re 629-lane 2 1
RE_WT=$(lane_wt re)

begin "re-injection prints a fresh stored snapshot, the plan-comment and PR pointers, and the reconcile instruction"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto"')"
printf 'STORED-SENTINEL\n' >>"$(state_file re main)"
run_hook "$POST_HOOK" "$(event "$RE_WT" ',"source":"compact"')"
expect_rc 0 "$rc"
[ -z "$err" ] || bad "re-injection wrote to stderr: $err"
for want in "STORED-SENTINEL" "trigger: auto" "issue: #629" "gh-owner-comments.sh issue 629" "## Plan (ticket-agent lane)" "gh pr list --head 629-lane" "gh-owner-comments.sh pr <n>" "git log --oneline origin/main..HEAD" "ticked"; do
  expect_stdout "$want"
done
end

begin "re-injection consumes the snapshot it used"
[ -e "$(state_file re main)" ] && bad "the stored snapshot survived the re-injection"
end

begin "with no stored snapshot the state is recomputed from git, trigger unknown"
run_hook "$POST_HOOK" "$(event "$RE_WT" ',"source":"compact"')"
expect_rc 0 "$rc"
expect_stdout "trigger: unknown"
expect_stdout "branch: 629-lane"
expect_stdout "step 02"
expect_stdout "u01.txt"
end

begin "a stored snapshot 14.5 minutes old is used"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto"')"
printf 'STORED-SENTINEL\n' >>"$(state_file re main)"
age_file "$(state_file re main)" 14.5
run_hook "$POST_HOOK" "$(event "$RE_WT")"
expect_rc 0 "$rc"
expect_stdout "STORED-SENTINEL"
end

begin "a stored snapshot 15.5 minutes old is not used, and is removed"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto"')"
printf 'STORED-SENTINEL\n' >>"$(state_file re main)"
age_file "$(state_file re main)" 15.5
run_hook "$POST_HOOK" "$(event "$RE_WT")"
expect_rc 0 "$rc"
expect_not_stdout "STORED-SENTINEL"
expect_stdout "trigger: unknown"
[ -e "$(state_file re main)" ] && bad "the stale snapshot survived"
end

begin "a snapshot stored for another agent is neither used nor consumed"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto","agent_id":"other1"')"
printf 'OTHER-SENTINEL\n' >>"$(state_file re other1)"
run_hook "$POST_HOOK" "$(event "$RE_WT" ',"agent_id":"mine2"')"
expect_rc 0 "$rc"
expect_not_stdout "OTHER-SENTINEL"
[ -f "$(state_file re other1)" ] || bad "another agent's snapshot was consumed"
end

begin "the same agent id finds its own snapshot"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto","agent_id":"mine2"')"
printf 'MINE-SENTINEL\n' >>"$(state_file re mine2)"
run_hook "$POST_HOOK" "$(event "$RE_WT" ',"agent_id":"mine2"')"
expect_stdout "MINE-SENTINEL"
end

# The branch grammar: only `<digits>-<slug>` is a lane. Each non-lane shape is silent by
# design; each lane shape names its issue. The oracle is `git rev-parse --abbrev-ref`.
for b in main x-629 v629-x 629 lane-6-x; do
  begin "re-injection is silent on branch '$b' (no issue to reconcile against)"
  make_lane "g_$b" "$b" 0 0
  [ "$(git -C "$(lane_wt "g_$b")" rev-parse --abbrev-ref HEAD)" = "$b" ] || bad "fixture is not on $b"
  run_hook "$POST_HOOK" "$(event "$(lane_wt "g_$b")")"
  expect_rc 0 "$rc"
  expect_silent
  run_hook "$PRE_HOOK" "$(event "$(lane_wt "g_$b")" ',"trigger":"auto"')"
  expect_rc 0 "$rc"
  expect_silent
  [ -e "$(state_file "g_$b" main)" ] && bad "pre-compact wrote a snapshot on non-lane branch $b"
  end
done

for pair in "6290-y:6290" "007-z:007" "629-a-b-c:629"; do
  b=${pair%%:*}
  want=${pair##*:}
  begin "re-injection on branch '$b' names issue #$want"
  make_lane "h_$b" "$b" 0 0
  run_hook "$POST_HOOK" "$(event "$(lane_wt "h_$b")")"
  expect_rc 0 "$rc"
  expect_stdout "issue: #$want"
  expect_stdout "gh-owner-comments.sh issue $want"
  end
done

begin "re-injection is silent on a plain detached HEAD"
make_lane detached 629-lane 0 0
must git -C "$(lane_wt detached)" checkout -q --detach
run_hook "$POST_HOOK" "$(event "$(lane_wt detached)")"
expect_rc 0 "$rc"
expect_silent
end

begin "re-injection recomputes with the event's agent_type and cwd"
must mkdir -p "$RE_WT/sub"
must rm -f "$(state_file re main)"
run_hook "$POST_HOOK" "$(event "$RE_WT/sub" ',"agent_type":"ticket-agent"')"
expect_rc 0 "$rc"
expect_stdout "agent_type: ticket-agent"
expect_stdout "cwd: $RE_WT/sub"
expect_stdout "continue from the first step that is neither committed nor ticked"
end

# The text is the same for every agent_type, present or not: live events carry none, so it
# addresses the lane's owner and any agent it dispatched at once.
for t in "" ticket-agent reviewer; do
  begin "re-injection text is role-neutral (agent_type '$t')"
  must rm -f "$(state_file re main)"
  run_hook "$POST_HOOK" "$(event "$RE_WT" "${t:+,\"agent_type\":\"$t\"}")"
  expect_rc 0 "$rc"
  expect_stdout "If you are the agent that owns that lane, reconcile"
  expect_stdout "continue from the first step that is neither committed nor ticked"
  expect_stdout "If you were dispatched by that agent for a narrower task"
  expect_stdout "you do not take up its steps"
  end
done

# A rebase detaches HEAD; the lane resolving one is the state it can least afford to lose. The
# oracle for "a rebase is in progress" is `git status`'s own words.
# make_rebasing <name> [--apply] -> a lane whose rebase onto a conflicting origin/main has stopped.
# The merge backend (default) keeps its state in rebase-merge/, the apply backend in rebase-apply/.
make_rebasing() {
  local wt
  make_lane "$1" 629-lane 0 0
  wt=$(lane_wt "$1")
  must printf 'lane\n' >"$wt/f.txt"
  must git -C "$wt" add f.txt
  must git -C "$wt" commit -q -m lane-edit
  must printf 'main\n' >"$TMP_ROOT/$1/main/f.txt"
  must git -C "$TMP_ROOT/$1/main" add f.txt
  must git -C "$TMP_ROOT/$1/main" commit -q -m main-edit
  must git -C "$TMP_ROOT/$1/main" update-ref refs/remotes/origin/main HEAD
  git -C "$wt" rebase ${2:+"$2"} origin/main >/dev/null 2>&1
  local st
  st=$(git -C "$wt" status 2>&1)
  case "$st" in
    *"rebase in progress"*) ;;
    *)
      printf 'FATAL fixture is not mid-rebase; git status says: %s\n' "$st" >&2
      exit 2
      ;;
  esac
}

make_rebasing rb
make_rebasing rbapply --apply
[ -d "$(git -C "$(lane_wt rb)" rev-parse --path-format=absolute --git-path rebase-merge)" ] || exit 2
[ -f "$(git -C "$(lane_wt rbapply)" rev-parse --path-format=absolute --git-path rebase-apply/head-name)" ] || exit 2

for r in rb rbapply; do
  begin "a lane mid-rebase ($r) is still a lane: both hooks name its branch and issue and say a rebase is in progress"
  run_hook "$PRE_HOOK" "$(event "$(lane_wt "$r")" ',"trigger":"auto"')"
  expect_rc 0 "$rc"
  snap=$(cat "$(state_file "$r" main)" 2>/dev/null)
  contains "$snap" "branch: 629-lane" || bad "branch not read through the rebase; got: $snap"
  contains "$snap" "issue: #629" || bad "issue not read through the rebase; got: $snap"
  contains "$snap" "rebase: in progress" || bad "rebase not named; got: $snap"
  run_hook "$POST_HOOK" "$(event "$(lane_wt "$r")")"
  expect_rc 0 "$rc"
  # A line of its own: the resume instruction quotes the phrase, so a bare substring proves nothing.
  expect_stdout $'\nrebase: in progress'
  expect_stdout "gh-owner-comments.sh issue 629"
  expect_stdout "finish or abort that rebase first"
  end
done

begin "a lane not in a rebase says nothing about one"
must rm -f "$(state_file re main)"
run_hook "$POST_HOOK" "$(event "$RE_WT")"
expect_not_stdout $'\nrebase: in progress'
end

# --- never blocks, never exits 2 ---------------------------------------------------------

for hook_name in PRE POST; do
  hook_path=$PRE_HOOK
  [ "$hook_name" = "POST" ] && hook_path=$POST_HOOK

  begin "$hook_name: an event with no cwd, run outside any repository, exits 0"
  must mkdir -p "$TMP_ROOT/loose"
  must printf '{"trigger":"auto"}' >"$TMP_ROOT/event.json"
  capture -C "$TMP_ROOT/loose" bash "$hook_path" <"$TMP_ROOT/event.json"
  expect_rc 0 "$rc"
  end

  begin "$hook_name: a cwd outside any repository exits 0"
  run_hook "$hook_path" "$(event "$TMP_ROOT/loose" ',"trigger":"auto"')"
  expect_rc 0 "$rc"
  end

  begin "$hook_name: a cwd that does not exist exits 0"
  run_hook "$hook_path" "$(event "$TMP_ROOT/does-not-exist" ',"trigger":"auto"')"
  expect_rc 0 "$rc"
  end

  begin "$hook_name: malformed JSON exits 0"
  run_hook "$hook_path" '{not json'
  expect_rc 0 "$rc"
  end

  begin "$hook_name: an empty event exits 0"
  run_hook "$hook_path" ''
  expect_rc 0 "$rc"
  end

  begin "$hook_name: a missing node is reported on stderr and still exits 0"
  run_hook "$hook_path" "$(event "$RE_WT" ',"trigger":"auto"')" HOOK_NODE_CMD=/nonexistent/node
  expect_rc 0 "$rc"
  expect_stderr "required tool not found"
  end

  begin "$hook_name: a crashing node is reported on stderr and still exits 0"
  must printf '#!/usr/bin/env bash\nexit 1\n' >"$TMP_ROOT/bad-node"
  must chmod +x "$TMP_ROOT/bad-node"
  run_hook "$hook_path" "$(event "$RE_WT" ',"trigger":"auto"')" HOOK_NODE_CMD="$TMP_ROOT/bad-node"
  expect_rc 0 "$rc"
  expect_stderr "could not read the hook event"
  end
done

# A node that serves its first <n> calls and then crashes: each later field read in a hook is a
# separate call, and each has its own failure arm.
must cat >"$TMP_ROOT/count-node" <<'SHIM'
#!/usr/bin/env bash
c=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
c=$((c + 1))
printf '%s' "$c" >"$COUNT_FILE"
[ "$c" -le "$ALLOW" ] && exec node "$@"
exit 1
SHIM
must chmod +x "$TMP_ROOT/count-node"
for pair in "PRE:1" "PRE:2" "PRE:3" "POST:1" "POST:2"; do
  which_hook=${pair%%:*}
  allow=${pair##*:}
  hook_path=$PRE_HOOK
  [ "$which_hook" = "POST" ] && hook_path=$POST_HOOK
  begin "$which_hook: a node that crashes after $allow call(s) still exits 0"
  must rm -f "$TMP_ROOT/count" "$(state_file re main)"
  run_hook "$hook_path" "$(event "$RE_WT" ',"trigger":"auto"')" HOOK_NODE_CMD="$TMP_ROOT/count-node" COUNT_FILE="$TMP_ROOT/count" ALLOW="$allow"
  expect_rc 0 "$rc"
  end
done

# A hook copied away from its siblings cannot load them: loud on stderr, and still 0.
begin "a hook that cannot load hook-context.sh or compaction-lib.sh says so and exits 0"
for name in pre-compact-snapshot.sh post-compact-reinject.sh; do
  must mkdir -p "$TMP_ROOT/alone_$name" "$TMP_ROOT/nolib_$name"
  must cp "$HOOKS/$name" "$TMP_ROOT/alone_$name/"
  must cp "$HOOKS/$name" "$HOOKS/hook-context.sh" "$TMP_ROOT/nolib_$name/"
  run_hook "$TMP_ROOT/alone_$name/$name" "$(event "$RE_WT")"
  expect_rc 0 "$rc"
  expect_stderr "could not load"
  expect_stderr "hook-context.sh"
  run_hook "$TMP_ROOT/nolib_$name/$name" "$(event "$RE_WT")"
  expect_rc 0 "$rc"
  expect_stderr "could not load"
  expect_stderr "compaction-lib.sh"
done
end

# No git on PATH. The hooks prepend /opt/homebrew/bin, which on some machines holds a git, so
# the case runs byte-for-byte copies of the hooks with that one PATH line deleted, against a PATH
# of symlinks that has everything they call but git. The fixture checks prove the deletion landed.
NOGIT_HOOKS="$TMP_ROOT/nogit-hooks"
NOGIT_BIN="$TMP_ROOT/nogit-bin"
must mkdir -p "$NOGIT_HOOKS" "$NOGIT_BIN"
PATH_LINE="export PATH=\"/opt/homebrew/bin:\$PATH\""
for f in hook-context.sh compaction-lib.sh pre-compact-snapshot.sh post-compact-reinject.sh; do
  fixture_has "$HOOKS/$f" "$PATH_LINE"
  must grep -vxF "$PATH_LINE" "$HOOKS/$f" >"$NOGIT_HOOKS/$f"
  fixture_lacks "$NOGIT_HOOKS/$f" 'export PATH="/opt/homebrew/bin'
done
for t in bash node env cat tr sed find date wc head rm dirname; do
  must ln -sf "$(command -v "$t")" "$NOGIT_BIN/$t"
done
[ ! -e "$NOGIT_BIN/git" ] || exit 2
GIT_DIR_OF=$(dirname "$(command -v git)")

for pair in "PRE:pre-compact-snapshot.sh" "POST:post-compact-reinject.sh"; do
  begin "${pair%%:*}: with no git on PATH the hook says so on stderr and still exits 0"
  run_hook "$NOGIT_HOOKS/${pair##*:}" "$(event "$RE_WT" ',"trigger":"auto"')" PATH="$NOGIT_BIN"
  expect_rc 0 "$rc"
  expect_stderr "required tool not found: git"
  end
done

begin "control: the same copies with git on PATH do their work"
must rm -f "$(state_file re main)"
run_hook "$NOGIT_HOOKS/pre-compact-snapshot.sh" "$(event "$RE_WT" ',"trigger":"auto"')" PATH="$NOGIT_BIN:$GIT_DIR_OF"
expect_rc 0 "$rc"
[ -f "$(state_file re main)" ] || bad "the copy wrote no snapshot with git on PATH"
run_hook "$NOGIT_HOOKS/post-compact-reinject.sh" "$(event "$RE_WT")" PATH="$NOGIT_BIN:$GIT_DIR_OF"
expect_rc 0 "$rc"
expect_stdout "Your context was just compacted"
end

# --- the stdin read is bounded -----------------------------------------------------
#
# Two pre-compact-snapshot.sh processes were found 11 hours old, blocked on a stdin pipe whose
# writer never closed. A hook that waits on stdin forever is a leaked process, so these cases hold
# stdin open and assert the hook gives up. The hook runs under run_bounded: a node supervisor that
# puts it in its own process group, SIGKILLs the group at the limit (a regression is a red case,
# never a hung suite), and, when the hook exits on its own, fails the case if the group still
# holds a process — a test must not leave one running.
run_bounded() { # run_bounded <limit-seconds> <cmd...> -> rc 124 at the limit, 125 on a survivor
  local limit="$1"
  shift
  capture node -e '
    const { spawn } = require("child_process");
    const [limit, ...cmd] = process.argv.slice(1);
    let timedOut = false;
    const c = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", detached: true });
    const alive = () => { try { process.kill(-c.pid, 0); return true; } catch (e) { return false; } };
    const t = setTimeout(() => { timedOut = true; try { process.kill(-c.pid, "SIGKILL"); } catch (e) {} }, Number(limit) * 1000);
    c.on("exit", (code) => {
      clearTimeout(t);
      const leftover = !timedOut && alive();
      try { process.kill(-c.pid, "SIGKILL"); } catch (e) {}
      process.exit(timedOut ? 124 : leftover ? 125 : (code === null ? 1 : code));
    });' "$limit" "$@"
}

FIFO="$TMP_ROOT/held-open.fifo"
must mkfifo "$FIFO"
for pair in "PRE:pre-compact-snapshot.sh" "POST:post-compact-reinject.sh"; do
  begin "${pair%%:*}: a stdin held open with no data is given up on within the bound, exit 0, nothing left running"
  exec 9<>"$FIFO"
  run_bounded 15 env HOOK_EVENT_TIMEOUT_S=2 bash "$HOOKS/${pair##*:}" <"$FIFO"
  exec 9>&-
  expect_rc 0 "$rc"
  expect_stderr "held open for 2s"
  end
done

begin "the default bound is under 9 seconds"
exec 9<>"$FIFO"
run_bounded 9 bash "$PRE_HOOK" <"$FIFO"
exec 9>&-
expect_rc 0 "$rc"
expect_stderr "held open for"
end

begin "POST: a stdin held open, run from the lane's worktree, re-injects the recomputed state"
exec 9<>"$FIFO"
cd "$RE_WT" || exit 2
run_bounded 15 env HOOK_EVENT_TIMEOUT_S=2 bash "$POST_HOOK" <"$FIFO"
cd "$TMP_ROOT" || exit 2
exec 9>&-
expect_rc 0 "$rc"
expect_stdout "branch: 629-lane"
expect_stdout "trigger: unknown"
end

# The original leak's shape: stdin closed at launch, so the pipe of `$(read_hook_event)` can take fd 0.
for pair in "PRE:pre-compact-snapshot.sh" "POST:post-compact-reinject.sh"; do
  begin "${pair%%:*}: a stdin closed at launch ends within the bound, exit 0, nothing left running"
  run_bounded 15 bash -c "exec <&-; exec env HOOK_EVENT_TIMEOUT_S=2 bash \"\$0\"" "$HOOKS/${pair##*:}"
  expect_rc 0 "$rc"
  end
done

begin "an event that arrives is read whole, however long it is"
big=$(printf '%0.sx' $(seq 1 3000))
run_hook "$PRE_HOOK" "$(event "$RE_WT" ",\"trigger\":\"auto\",\"custom_instructions\":\"$big\"")" HOOK_EVENT_TIMEOUT_S=2
expect_rc 0 "$rc"
snap=$(cat "$(state_file re main)" 2>/dev/null)
contains "$snap" "trigger: auto" || bad "a 3 KB event was not read whole; got: $snap"
end

begin "pre-compact reports a snapshot it cannot write on stderr and still exits 0"
must rm -f "$(state_file re main)"
must mkdir -p "$(state_file re main)"
run_hook "$PRE_HOOK" "$(event "$RE_WT" ',"trigger":"auto"')"
expect_rc 0 "$rc"
expect_stderr "could not write"
must rmdir "$(state_file re main)"
end

# --- the hooks reach no network ------------------------------------------------------

# `check:no-network-egress` censuses workspace sources, not .claude/hooks, so this is where the
# constraint is held for these three files. A floor, not a proof: the words a shell script
# opens a connection with. The re-injection's pointer
# text names `gh` commands inside backticks for the model to run; that text is filtered out, a call is not.
begin "the compaction scripts name no network-capable command"
for f in pre-compact-snapshot.sh post-compact-reinject.sh compaction-lib.sh; do
  code=$(grep -v '^[[:space:]]*#' "$HOOKS/$f" | grep -vF '\`gh ' | grep -E '(^|[^[:alnum:]_.-])(gh|curl|wget|nc|ncat|ssh|scp|telnet|ftp)( |$)|/dev/(tcp|udp)|git (fetch|pull|push|clone|ls-remote)' || true)
  [ -z "$code" ] || bad "$f: $code"
done
end

finish
