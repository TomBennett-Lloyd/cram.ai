#!/usr/bin/env bash
#
# Harness for .claude/hooks/guard-dirty-revert.sh: one case per refuse arm and
# per pass arm, each run against a throwaway git repo whose tracked files are
# dirty or clean by name.
#
# Usage: bash .claude/scripts/guard-dirty-revert.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
HOOK=${GUARD_DIRTY_REVERT_HOOK:-$SCRIPTS/../hooks/guard-dirty-revert.sh}

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

REPO="$TMP_ROOT/repo"
PLAIN="$TMP_ROOT/plain"
DIRTY_FILES=(dirty.txt side sub/deep.txt 'with space.txt' 'q"t.txt' 'b\s.txt' $'b\x60t.txt' $'t\tb.txt' 'hash#name.txt' -dash.txt x-y)

must git init -q -b main "$REPO"
must git -C "$REPO" config user.email "harness@example.invalid"
must git -C "$REPO" config user.name "Harness"
must git -C "$REPO" config commit.gpgsign false
must mkdir -p "$REPO/sub" "$PLAIN"
for f in "${DIRTY_FILES[@]}" clean.txt; do
  must cp /dev/null "$REPO/$f"
done
must git -C "$REPO" add -A
must git -C "$REPO" commit -q -m seed
must git -C "$REPO" branch side
for f in "${DIRTY_FILES[@]}"; do
  printf 'uncommitted\n' >"$REPO/$f" || exit 2
done
must cp /dev/null "$REPO/untracked.txt"

# CONF: conf.txt unmerged (UU) mid-merge, other.txt an ordinary dirty file beside it.
CONF="$TMP_ROOT/conf"
must git init -q -b main "$CONF"
must git -C "$CONF" config user.email "harness@example.invalid"
must git -C "$CONF" config user.name "Harness"
must git -C "$CONF" config commit.gpgsign false
printf 'base\n' >"$CONF/conf.txt" || exit 2
must cp /dev/null "$CONF/other.txt"
must git -C "$CONF" add -A
must git -C "$CONF" commit -q -m base
must git -C "$CONF" checkout -q -b theirs
printf 'theirs\n' >"$CONF/conf.txt" || exit 2
must git -C "$CONF" commit -q -am theirs
must git -C "$CONF" checkout -q main
printf 'ours\n' >"$CONF/conf.txt" || exit 2
must git -C "$CONF" commit -q -am ours
if git -C "$CONF" merge -q theirs >/dev/null 2>&1; then
  printf 'FATAL harness setup failed: the CONF merge did not conflict\n' >&2
  exit 2
fi
printf 'uncommitted\n' >"$CONF/other.txt" || exit 2

# event <cwd|-> <command> -> a Bash PreToolUse event at $TMP_ROOT/event.json; `-` omits cwd.
event() {
  must node -e '
    const [, cwd, command] = process.argv;
    const ev = { tool_name: "Bash", tool_input: { command } };
    if (cwd !== "-") ev.cwd = cwd;
    process.stdout.write(JSON.stringify(ev));
  ' "$1" "$2" >"$TMP_ROOT/event.json"
}

# refuses <command> <operand> [cwd] — exit 2, the operand and rule 8 on stderr, nothing on stdout.
refuses() {
  begin "refuses: $1"
  event "${3:-$REPO}" "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 2
  expect_stderr "  $2 (in "
  expect_stderr "docs/standards/testing.md rule 8"
  expect_stderr "a copy you set aside"
  [ -z "$out" ] || bad "expected no stdout; got: $out"
  end
}

# passes <command> [cwd] — exit 0, silent.
passes() {
  begin "passes: $1"
  event "${2:-$REPO}" "$1"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 0
  expect_silent
  end
}

# --- checkout ----------------------------------------------------------------------------

refuses 'git checkout -- dirty.txt' dirty.txt
refuses 'git checkout dirty.txt' dirty.txt
refuses 'git checkout HEAD -- dirty.txt' dirty.txt
refuses 'git checkout side dirty.txt' dirty.txt
refuses 'git checkout side side' side
refuses 'git checkout .' .
refuses 'git checkout -- -dash.txt' -dash.txt
passes 'git checkout side'
passes 'git checkout -q side'
passes 'git checkout -b dirty.txt'
passes 'git checkout -B dirty.txt'
passes 'git checkout --orphan dirty.txt'
passes 'git checkout -- clean.txt'
passes 'git checkout -- untracked.txt'

# --- restore -----------------------------------------------------------------------------

refuses 'git restore dirty.txt' dirty.txt
refuses 'git restore -- dirty.txt' dirty.txt
refuses 'git restore --staged --worktree dirty.txt' dirty.txt
refuses 'git restore -SW dirty.txt' dirty.txt
refuses 'git restore -sHEAD dirty.txt' dirty.txt
refuses 'git restore --ours dirty.txt' dirty.txt
refuses 'git restore x-y' x-y
passes 'git restore --staged dirty.txt'
passes 'git restore -S dirty.txt'
passes 'git restore --source dirty.txt clean.txt'
passes 'git restore -Ws dirty.txt clean.txt'
passes 'git restore -S -sW dirty.txt'

# --- conflict resolution ------------------------------------------------------------------

passes 'git checkout --theirs conf.txt' "$CONF"
passes 'git restore --ours conf.txt' "$CONF"
refuses 'git checkout --theirs conf.txt other.txt' other.txt "$CONF"

# --- which tree -------------------------------------------------------------------------

refuses 'cd sub && git checkout -- deep.txt' deep.txt
refuses 'git -C sub checkout -- deep.txt' deep.txt
refuses 'git -c core.quotepath=off checkout -- dirty.txt' dirty.txt
refuses 'git --no-pager checkout -- dirty.txt' dirty.txt
refuses "cd $PLAIN && cd $REPO && git checkout -- dirty.txt" dirty.txt
passes "cd $PLAIN && git checkout -- dirty.txt"
passes 'git checkout -- dirty.txt' "$PLAIN"

begin "refuses: a bare cd goes to HOME"
event "$PLAIN" 'cd && git checkout -- dirty.txt'
HOME="$REPO" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

begin "refuses: an empty cwd in the event falls back to the hook's own working directory"
event '' 'git checkout -- dirty.txt'
capture -C "$REPO" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

begin "refuses: no cwd in the event falls back to the hook's own working directory"
event - 'git checkout -- dirty.txt'
capture -C "$REPO" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "  dirty.txt (in $REPO)"
end

# --- a cd inside a backtick body (#282) ---------------------------------------------------
# One `refuses <operand> <command>` or `passes - <command>` per line, a quoted heredoc as below.
# deep.txt is dirty only in sub/, dirty.txt only at the root.
while read -r verdict operand row; do
  case $verdict in
    refuses) refuses "$row" "$operand" ;;
    passes) passes "$row" ;;
    *)
      printf 'FATAL harness row has no verdict: %s %s %s\n' "$verdict" "$operand" "$row" >&2
      exit 2
      ;;
  esac
done <<'ROWS'
refuses dirty.txt d=`cd sub && pwd`; git checkout -- dirty.txt
refuses dirty.txt echo `cd sub`; git checkout -- dirty.txt
refuses dirty.txt echo "`cd sub`"; git checkout -- dirty.txt
refuses deep.txt echo `cd sub && git checkout -- deep.txt`
refuses deep.txt echo `cd sub; echo \`git checkout -- deep.txt\``
refuses dirty.txt echo `echo \`cd sub\`; git checkout -- dirty.txt`
refuses deep.txt cd sub && echo `cd ..`; git checkout -- deep.txt
refuses deep.txt echo `cd sub; echo \`cd ..\`; git checkout -- deep.txt`
passes - d=`cd sub && pwd`; git checkout -- deep.txt
passes - echo `cd sub`; git checkout -- deep.txt
passes - echo `cd sub && git checkout -- dirty.txt`
passes - echo `echo \`cd sub\`; git checkout -- deep.txt`
passes - cd sub && echo `cd ..`; git checkout -- dirty.txt
ROWS

# --- the command line --------------------------------------------------------------------

refuses 'true; git checkout -- dirty.txt' dirty.txt
refuses 'true & git checkout -- dirty.txt' dirty.txt
refuses 'true | git checkout -- dirty.txt' dirty.txt
refuses "echo \$(git checkout -- dirty.txt)" dirty.txt
refuses $'true\ngit checkout -- dirty.txt' dirty.txt
refuses $'git\tcheckout -- dirty.txt' dirty.txt
refuses $'git checkout -- \\\ndirty.txt' dirty.txt
refuses "git checkout -- 'with space.txt'" 'with space.txt'
refuses 'git checkout -- "with space.txt"' 'with space.txt'
refuses 'git checkout -- with\ space.txt' 'with space.txt'
refuses 'git checkout -- "q\"t.txt"' 'q"t.txt'
refuses 'git checkout -- "b\\s.txt"' 'b\s.txt'
refuses "git checkout -- \"b\\\`t.txt\"" $'b\x60t.txt'
refuses 'git checkout -- hash#name.txt' 'hash#name.txt'
refuses $'cat <<\'EOF\'\nbody\nEOF\ntrue\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<-EOF\n\tbody\n\tEOF\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<<x\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat << "EOF"\nbody\nEOF\ngit checkout -- dirty.txt' dirty.txt
refuses $'cat <<EOF >/dev/null\nbody\nEOF\ngit checkout -- dirty.txt' dirty.txt
passes 'git commit -m "git checkout -- dirty.txt"'
passes $'git commit -m "$(cat <<\'EOF\'\n#1: drop the old advice "revert it (git checkout -- dirty.txt)"\nEOF\n)"'
passes $'git commit -m "$(cat <<\'EOF\'\n#1: a 6" ruler\ngit restore dirty.txt was the bad revert\nEOF\n)"'
refuses "echo \"\$(git checkout -- dirty.txt)\"" dirty.txt
refuses "git commit -m \"\$(echo x)\" && git checkout -- dirty.txt" dirty.txt
refuses "echo \"\$(true; (true); git checkout -- dirty.txt)\"" dirty.txt
passes "echo \"\$( (true) ) git checkout -- dirty.txt\""
refuses "echo \"\$(echo \$(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(cat <(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(tee >(true); git checkout -- dirty.txt)\"" dirty.txt
refuses "echo \"\$(echo \${b%(*})\" && git checkout -- dirty.txt" dirty.txt
passes "echo \"\$(echo \${x%(*}) git checkout -- dirty.txt\""
passes $'git commit -F - <<\'EOF\'\ngit checkout -- dirty.txt\nEOF'

# --- units inside "$(...)" (#268) -------------------------------------------------------
# The rows are a quoted heredoc so that shellcheck does not read their `$` as unexpanded
# (SC2016): one `refuses|passes <command>` per line, `\n` standing for a newline, and every
# refusal names dirty.txt.
while read -r verdict row; do
  row=${row//\\n/$'\n'}
  case $verdict in
    refuses) refuses "$row" dirty.txt ;;
    passes) passes "$row" ;;
    *)
      printf 'FATAL harness row has no verdict: %s %s\n' "$verdict" "$row" >&2
      exit 2
      ;;
  esac
done <<'ROWS'
refuses echo "$(echo ${x//(/)}; git checkout -- dirty.txt)"
refuses echo "$(echo ${x%)}; git checkout -- dirty.txt)"
refuses echo "$(echo ${x:-"}"}; git checkout -- dirty.txt)"
refuses echo "$(echo "${x:-")"}"; git checkout -- dirty.txt)"
refuses echo "$(echo ${x:-'}'}; git checkout -- dirty.txt)"
refuses echo "$(echo ${x:-${y%)}}; git checkout -- dirty.txt)"
refuses echo "$(echo ${x:-${y}%)}; git checkout -- dirty.txt)"
refuses echo "$(echo ${x:-\}%)}; git checkout -- dirty.txt)"
refuses echo ${x:-$(git checkout -- dirty.txt)}
refuses echo "${x:-$(git checkout -- dirty.txt)}"
refuses echo "$(echo ${x:-$(git checkout -- dirty.txt)})"
refuses echo "${x:-"$(git checkout -- dirty.txt)"}"
passes echo "$(echo ${x//(/)}) git checkout -- dirty.txt"
passes echo "${x:-'}"; echo '; git checkout -- dirty.txt'
refuses echo "${x:-'}"; git checkout -- dirty.txt; echo "'}"
passes echo "\$(git checkout -- dirty.txt)"
passes echo "\${x:-$(true)}" git checkout -- dirty.txt
refuses echo "$(echo @(a|b); git checkout -- dirty.txt)"
refuses echo "$(a=(1 2); git checkout -- dirty.txt)"
refuses echo "$(a+=(1); git checkout -- dirty.txt)"
refuses echo "$([[ x =~ ^(a)$ ]]; git checkout -- dirty.txt)"
refuses echo "$(ls [(]*); git checkout -- dirty.txt)"
passes echo "$(echo [)]*) git checkout -- dirty.txt"
refuses echo "$(echo $((1+(2))); git checkout -- dirty.txt)"
passes echo $(true) git checkout -- dirty.txt
passes cat <(true) git checkout -- dirty.txt
passes echo "$(echo @(a|b) git checkout -- dirty.txt)"
refuses git checkout -- dirty.txt(N)
refuses x=$(true) git checkout -- dirty.txt
refuses A_1=x git checkout -- dirty.txt
refuses a+=x git checkout -- dirty.txt
refuses _=x b=y git checkout -- dirty.txt
passes 1a=x git checkout -- dirty.txt
passes a-b=x git checkout -- dirty.txt
refuses echo "$(case x in a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) true;; esac)" && git checkout -- dirty.txt
refuses echo "$(case x in (a) true;; esac)" && git checkout -- dirty.txt
refuses echo "$(case esac in (esac) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) git checkout -- dirty.txt;; esac)"
refuses echo "$(case x in @((b))) true;; esac; git checkout -- dirty.txt)"
refuses echo `case x in a) true;; esac`; git checkout -- dirty.txt
refuses echo `case x in a) git checkout -- dirty.txt;; esac`
passes echo checkout;; true
refuses echo "$(case x in a|b) true;; c) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in esac)" && git checkout -- dirty.txt
refuses echo "$(case x in a|esac) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a|(b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) echo esac;; b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) true\nesac; git checkout -- dirty.txt)"
refuses echo "$(case x\nin a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) true;& b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) true;;& b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) true;| b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) echo $(true);; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in @(a|b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case $(true) in a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) case y in b) true;; esac;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in a) (case y in b) true;; esac);; esac; git checkout -- dirty.txt)"
refuses echo "$(! case x in a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$({ case x in a) true;; esac; }; git checkout -- dirty.txt)"
refuses echo "$(if case x in a) true;; esac; then true; fi; git checkout -- dirty.txt)"
refuses echo "$(if true; then case x in a) true;; esac; fi; git checkout -- dirty.txt)"
refuses echo "$(if false; then true; elif case x in a) true;; esac; then true; fi; git checkout -- dirty.txt)"
refuses echo "$(if false; then true; else case x in a) true;; esac; fi; git checkout -- dirty.txt)"
refuses echo "$(while false; do case x in a) true;; esac; done; git checkout -- dirty.txt)"
refuses echo "$(while case x in a) false;; esac; do true; done; git checkout -- dirty.txt)"
refuses echo "$(until case x in a) true;; esac; do true; done; git checkout -- dirty.txt)"
refuses echo "$(time case x in a) true;; esac; git checkout -- dirty.txt)"
passes echo "$(case x in a) true;; esac) git checkout -- dirty.txt"
passes echo "$(echo case x in a) git checkout -- dirty.txt"
refuses echo "$($'a\'b'; git checkout -- dirty.txt)"
refuses $'a\'b'; git checkout -- dirty.txt
refuses echo x$'a\'b'y; git checkout -- dirty.txt
refuses echo ${x:-$'a\'b'}; git checkout -- dirty.txt
refuses echo "$(echo ${x:-$'}\''}; git checkout -- dirty.txt)"
refuses echo "${x:-$'}"; git checkout -- dirty.txt
passes echo $'; git checkout -- dirty.txt'
passes echo "$(echo $'a\'b') git checkout -- dirty.txt"
passes echo $'$(git checkout -- dirty.txt)'
passes echo $'`git checkout -- dirty.txt`'
refuses echo `git checkout -- dirty.txt`
refuses echo "`git checkout -- dirty.txt`"
refuses echo "$(echo `git checkout -- dirty.txt`)"
refuses echo `echo \`git checkout -- dirty.txt\``
refuses echo ${x:-`git checkout -- dirty.txt`}
refuses echo `echo x # `; git checkout -- dirty.txt
refuses echo `git \\ncheckout -- dirty.txt`
refuses echo `echo \\`; git checkout -- dirty.txt
refuses echo `echo \\` `git checkout -- dirty.txt`
passes echo `echo a` git checkout -- dirty.txt
passes `echo a` git checkout -- dirty.txt
passes echo `echo "`"; git checkout -- dirty.txt`
passes echo `echo '`'; git checkout -- dirty.txt`
passes echo `echo # git checkout -- dirty.txt`
passes echo `cat <<X\ngit checkout -- dirty.txt\nX\n`
passes echo $'\U110000' checkout
passes echo `echo \${x:-; git checkout -- dirty.txt }`
refuses echo "$(case x in (a|b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a|(b))) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)|(b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)(b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a|b)x) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a) | (b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a|b) ) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a) true;; (b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case a in (a|b)) git checkout -- dirty.txt;; esac)"
refuses echo "$(case x in (a)|esac) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a) esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)\ntrue;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a);; esac; git checkout -- dirty.txt)"
passes echo "$(case x in (a|b)) true;; esac) git checkout -- dirty.txt"
passes echo "$(case x in (a)\ntrue;; esac) git checkout -- dirty.txt"
passes echo "$(case x in (a);; esac) git checkout -- dirty.txt"
passes echo "$(case x in (a) esac) git checkout -- dirty.txt"
refuses echo "$(f() { case x in a) true;; esac; }; git checkout -- dirty.txt)"
refuses echo "$(function f { case x in a) true;; esac; }; git checkout -- dirty.txt)"
refuses echo "$(function f() { case x in a) true;; esac; }; git checkout -- dirty.txt)"
refuses echo "$(f() case x in a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(f () { case x in a) true;; esac; }; git checkout -- dirty.txt)"
refuses echo "$(coproc case x in a) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(f() git checkout -- dirty.txt; f)"
passes echo "$(f() { case x in a) true;; esac; }) git checkout -- dirty.txt"
passes echo "$(function f { case x in a) true;; esac; }) git checkout -- dirty.txt"
passes echo "$(coproc case x in a) true;; esac) git checkout -- dirty.txt"
passes echo $() git checkout -- dirty.txt
passes echo x(N) git checkout -- dirty.txt
refuses echo "$(case x in (case) true;; b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a|(case)) true;; b) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)#) true;; esac; git checkout -- dirty.txt)"
passes echo "$(case x in (a)#) true;; esac) git checkout -- dirty.txt"
refuses echo "$(case x in (a)	| (b)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in x(case)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in @(case)) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a|x(case))) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)esac) true;; esac; git checkout -- dirty.txt)"
refuses echo "$(case x in (a)esac|b) true;; esac; git checkout -- dirty.txt)"
passes echo "$(case x in x(case)) true;; esac) git checkout -- dirty.txt"
passes echo "$(case x in @(case)) true;; esac) git checkout -- dirty.txt"
passes echo "$(case x in (a)esac) true;; esac) git checkout -- dirty.txt"
refuses echo "$(case x in (a)	true;; esac; git checkout -- dirty.txt)"
passes echo "$(case x in (a)	true;; esac) git checkout -- dirty.txt"
refuses echo "$(case xa in x$(case y in y) echo a;; esac)) git checkout -- dirty.txt;; esac)"
refuses echo $((1<<2))\ngit checkout -- dirty.txt
refuses echo $(( 1 << 2 ))\ngit checkout -- dirty.txt
refuses echo $((1<<(2)))\ngit checkout -- dirty.txt
refuses echo "$(echo $((1<<(2)))\ngit checkout -- dirty.txt)"
refuses echo "$((1<<2))"\ngit checkout -- dirty.txt
refuses echo ${x:-$((1<<2))}\ngit checkout -- dirty.txt
refuses echo "$(echo $((1<<2))\ngit checkout -- dirty.txt)"
refuses x=$((1<<2))\ngit checkout -- dirty.txt
refuses echo "$((true); git checkout -- dirty.txt)"
refuses echo $((true); git checkout -- dirty.txt)
refuses echo "$(( $(git checkout -- dirty.txt) ))"
refuses echo $(( `git checkout -- dirty.txt` ))
refuses (( 1<<2 ))\ngit checkout -- dirty.txt
refuses ((1<<2)); git checkout -- dirty.txt
refuses ((true); git checkout -- dirty.txt)
refuses echo "$(case a in ((a|b)) git checkout -- dirty.txt;; esac)"
passes echo $((1<<2))
passes echo $((1<<2)) git checkout -- dirty.txt
passes ((git checkout -- dirty.txt))
refuses a[1]=x git checkout -- dirty.txt
refuses a[1+1]=x git checkout -- dirty.txt
refuses a[1]+=x git checkout -- dirty.txt
refuses a[1]=x b[2]=y git checkout -- dirty.txt
refuses a[$(echo 1)]=x git checkout -- dirty.txt
refuses a[1,2]=x git checkout -- dirty.txt
refuses a[1]=(x) git checkout -- dirty.txt
refuses a[$(git checkout -- dirty.txt)]=x true
refuses echo "$(a[1]=x git checkout -- dirty.txt)"
passes echo a[1]=x git checkout -- dirty.txt
passes a[1]x=y git checkout -- dirty.txt
refuses echo $(($((1<<2))<<1))\ngit checkout -- dirty.txt
refuses echo $(( ${x:-$(git checkout -- dirty.txt)} ))
refuses echo $(( $(echo 1) << 2 ))\ngit checkout -- dirty.txt
refuses echo $(( ')' ))\ngit checkout -- dirty.txt
refuses echo "$(( ))"\ngit checkout -- dirty.txt
refuses echo ${x:-"$((1<<2))"}\ngit checkout -- dirty.txt
refuses echo `echo $((1<<2))\ngit checkout -- dirty.txt`
refuses x=$((1<<2)) git checkout -- dirty.txt
refuses echo $((true) ); git checkout -- dirty.txt
refuses true; (( 1<<2 ))\ngit checkout -- dirty.txt
refuses ((1)) && git checkout -- dirty.txt
refuses echo "$(((1<<2))\ngit checkout -- dirty.txt)"
refuses echo "$( (true))"; git checkout -- dirty.txt
refuses echo "$( ((1<<2)))"; git checkout -- dirty.txt
refuses echo "$(case a in a) ((1<<2))\ngit checkout -- dirty.txt;; esac)"
refuses echo "$(case a in ((a)) git checkout -- dirty.txt;; esac)"
passes a=((1<<2))\ngit checkout -- dirty.txt
refuses a[1]=x a+=y git checkout -- dirty.txt
refuses a[1]=x\ngit checkout -- dirty.txt
passes 1a[1]=x git checkout -- dirty.txt
passes a]=x git checkout -- dirty.txt
passes a[=x git checkout -- dirty.txt
refuses echo $(( ${x:-'$(git checkout -- dirty.txt)'} ))
refuses echo $(( '$(git checkout -- dirty.txt)' ))
passes echo $(( ${x:-\$(git checkout -- dirty.txt)} ))
passes echo $(( \$(git checkout -- dirty.txt) ))
passes ((1)) git checkout -- dirty.txt
refuses echo $(( `true '))'` )); git checkout -- dirty.txt; echo 'x'
refuses echo "$(( `true '))'` ))"; git checkout -- dirty.txt; echo 'x'
refuses echo ${y:-$(( `true '))'` ))}; git checkout -- dirty.txt; echo 'x'
refuses x=1; echo $(( ${x:-'))'} )); git checkout -- dirty.txt; echo 'x'
refuses x=1; echo $(( ${x:-'))'} ))\ngit checkout -- dirty.txt; echo 'x'
refuses echo $(( $(true ')))') )); git checkout -- dirty.txt; echo 'x'
refuses x=1; (( ${x:-'))'} )); git checkout -- dirty.txt; echo 'x'
refuses (( `true '))'` )); git checkout -- dirty.txt; echo 'x'
refuses echo ((a'))')); git checkout -- dirty.txt; echo 'x'
refuses true && echo ((a'))')); git checkout -- dirty.txt; echo 'x'
passes g$((echo x) )it checkout -- dirty.txt
passes g$((1))it checkout -- dirty.txt
passes ((1))git checkout -- dirty.txt
passes echo $(( "))'" )); git checkout -- dirty.txt; echo 'x'
passes x=1; echo $(( ${x:-'}))'} )); git checkout -- dirty.txt; echo 'x'
refuses x=1; echo "$(( ${x:-'))'} ))"; git checkout -- dirty.txt; echo 'x'
refuses case a in b) true;; ((a)) git checkout -- dirty.txt;; esac
refuses echo ((a)); git checkout -- dirty.txt
refuses echo "$(git checkout -- dirty.txt))"
refuses echo ${x:-$(git checkout -- dirty.txt))}
refuses echo x(((a'))')))\ngit checkout -- dirty.txt
refuses echo x(((a'))'))); git checkout -- dirty.txt
refuses echo @(((a'))'))); git checkout -- dirty.txt
refuses a=(((a'))'))); git checkout -- dirty.txt
refuses echo ((((a'))')))); git checkout -- dirty.txt
refuses echo x(y|((a'))'))); git checkout -- dirty.txt
refuses echo "$(echo x(((a'))'))); git checkout -- dirty.txt)"
passes echo x(((1<<2)))\ngit checkout -- dirty.txt
passes a=(((1<<2)))\ngit checkout -- dirty.txt
refuses ( ((1<<2))\ngit checkout -- dirty.txt )
refuses cat <( ((1<<2))\ngit checkout -- dirty.txt )
refuses echo "$( ((1<<2))\ngit checkout -- dirty.txt )"
refuses { ((1<<2)) }\ngit checkout -- dirty.txt
passes echo $(( '$(git checkout -- dirty.txt)' ); true)
passes echo $(( '`git checkout -- dirty.txt`' ); true)
passes echo "$(( '$(git checkout -- dirty.txt)' ); true)"
passes (( '$(git checkout -- dirty.txt)' ); true)
passes echo $(( # $(git checkout -- dirty.txt)\n); true)
refuses echo x(case|y); echo $(echo x\n((1<<2))\ngit checkout -- dirty.txt)
refuses echo x(case) $(true x\n((1<<2))\ngit checkout -- dirty.txt)
refuses a=(case) $(true x\n((1<<2))\ngit checkout -- dirty.txt)
refuses echo x(y|case) $(true x\n((1<<2))\ngit checkout -- dirty.txt)
passes echo x(case|y) $(true a\n((a)) git checkout -- dirty.txt)
refuses >/dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses >/dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses > /dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses > /dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses >>/dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses >>/dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses </dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses </dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses >|/dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses >|/dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses 2>&1 (case x in x) git checkout -- dirty.txt;; esac)
refuses 2>&1 ( ((1<<2))\ngit checkout -- dirty.txt )
refuses !>/dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses !>/dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses time >/dev/null (case x in x) git checkout -- dirty.txt;; esac)
refuses time >/dev/null ( ((1<<2))\ngit checkout -- dirty.txt )
refuses { >/dev/null (case x in x) git checkout -- dirty.txt;; esac) }
refuses { >/dev/null ( ((1<<2))\ngit checkout -- dirty.txt ) }
refuses repeat 1 (case x in x) git checkout -- dirty.txt;; esac)
refuses repeat 1 ( ((1<<2))\ngit checkout -- dirty.txt )
refuses for x (1) (case x in x) git checkout -- dirty.txt;; esac)
refuses for x (1) ( ((1<<2))\ngit checkout -- dirty.txt )
refuses for ((i=0;i<1;i++)) (case x in x) git checkout -- dirty.txt;; esac)
refuses for ((i=0;i<1;i++)) ( ((1<<2))\ngit checkout -- dirty.txt )
refuses {(case x in x) git checkout -- dirty.txt;; esac)}
refuses {( ((1<<2))\ngit checkout -- dirty.txt )}
refuses if >/dev/null (case x in x) git checkout -- dirty.txt;; esac); then :; fi
refuses if >/dev/null ( ((1<<2))\ngit checkout -- dirty.txt ); then :; fi
refuses cat =( ((1<<2))\ngit checkout -- dirty.txt )
refuses cat >( ((1<<2))\ngit checkout -- dirty.txt )
refuses >/dev/null ((1<<2))\ngit checkout -- dirty.txt
refuses echo ((<(git checkout -- dirty.txt)))
refuses echo ( ((>(git checkout -- dirty.txt))) )
refuses cat =(case x in x) git checkout -- dirty.txt;; esac)
refuses cat >(case x in x) git checkout -- dirty.txt;; esac)
refuses cat =( ((1<<2+'1'))\ngit checkout -- dirty.txt )
refuses cat >( ((1<<2+'1'))\ngit checkout -- dirty.txt )
refuses ( ((1<<2+'1'))\ngit checkout -- dirty.txt )
refuses ((1<<2+'1'))\ngit checkout -- dirty.txt
refuses echo ((a"))")); git checkout -- dirty.txt
refuses echo ((#x)); git checkout -- dirty.txt
refuses >/dev/null ( (( #x )); git checkout -- dirty.txt )
refuses >/dev/null ( ((1<(2<<1)))\ngit checkout -- dirty.txt )
refuses >/dev/null ((a=(1<<2)))\ngit checkout -- dirty.txt
refuses echo ((a|cd)); git checkout -- dirty.txt
ROWS
passes '# git checkout -- dirty.txt'
passes 'true # ; git checkout -- dirty.txt'
passes 'echo checkout -- dirty.txt'
passes 'ls dirty.txt'
refuses "git checkout -- \$'with\\x20space.txt'" 'with space.txt'
refuses "git checkout -- \$'q\\\"t.txt'" 'q"t.txt'
refuses "git checkout -- \$'b\\\\s.txt'" 'b\s.txt'
refuses "git checkout -- \$'with\\ space.txt'" 'with space.txt'
refuses "git checkout -- \$'with\\040space.txt'" 'with space.txt'
refuses "git checkout -- \$'t\\tb.txt'" $'t\tb.txt'
refuses "echo \`git checkout -- b\\\\\\\\s.txt\`" 'b\s.txt'

# --- cannot judge: exit 1, loud, never a refusal -----------------------------------------

must mkdir -p "$TMP_ROOT/bin"
printf '#!/usr/bin/env bash\nexit 3\n' >"$TMP_ROOT/bin/node-crash" || exit 2
must chmod +x "$TMP_ROOT/bin/node-crash"

begin "an event naming neither checkout nor restore never reaches the interpreter"
event "$REPO" 'ls dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "a crashing interpreter is exit 1 and says the call was not checked"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: $TMP_ROOT/bin/node-crash exited non-zero"
end

printf '#!/nonexistent/interpreter\n' >"$TMP_ROOT/bin/git-unspawnable" || exit 2
must chmod +x "$TMP_ROOT/bin/git-unspawnable"

begin "a git that resolves but cannot be spawned is exit 1, never a refusal"
event "$REPO" 'git checkout side'
HOOK_GIT_CMD="$TMP_ROOT/bin/git-unspawnable" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: could not run $TMP_ROOT/bin/git-unspawnable"
expect_not_stderr "refused"
expect_not_stderr "TypeError"
end

begin "a missing git is exit 1 and names the tool"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_GIT_CMD="$TMP_ROOT/bin/no-such-git" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: required tool not found: $TMP_ROOT/bin/no-such-git"
end

begin "a missing interpreter is exit 1 and names the tool"
event "$REPO" 'git checkout -- dirty.txt'
HOOK_NODE_CMD="$TMP_ROOT/bin/no-such-node" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-dirty-revert: required tool not found: $TMP_ROOT/bin/no-such-node"
end

begin "an unparseable event that mentions checkout passes silently"
printf '{"tool_input": checkout' >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "an event with no command string that mentions checkout passes silently"
printf '{"tool_input": {"file_path": "checkout"}, "cwd": "%s"}' "$REPO" >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "the hook parses under every bash on the box"
expect_parses "$HOOK"
end

finish
