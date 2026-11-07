#!/usr/bin/env bash
#
# Harness for .claude/hooks/guard-script-integrity.sh: one case per refuse arm and per pass arm.
# REPO is a throwaway git repository whose `main` holds the reference scripts and the settings.json
# naming the allow rules; each tree under TMP_ROOT is a plain directory holding a copy of
# `.claude/scripts`, identical or edited by name.
#
# Usage: bash .claude/scripts/guard-script-integrity.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
HOOK=${GUARD_SCRIPT_INTEGRITY_HOOK:-$SCRIPTS/../hooks/guard-script-integrity.sh}

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

REPO="$TMP_ROOT/repo"
must git init -q -b main "$REPO"
must git -C "$REPO" config user.email "harness@example.invalid"
must git -C "$REPO" config user.name "Harness"
must git -C "$REPO" config commit.gpgsign false
must mkdir -p "$REPO/.claude/scripts"
S="$REPO/.claude/scripts"
cat >"$S/fill-verdict.sh" <<'SH' || exit 2
#!/usr/bin/env bash
# mentions "$script_dir/decoy.sh" in a comment only
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/worktree-lib.sh"
. "$script_dir/second-lib.sh"
node "$script_dir/pr-facts.mjs"
SH
printf 'echo edit-comment\n' >"$S/edit-comment.sh" || exit 2
cat >"$S/sweep-orphans.sh" <<'SH' || exit 2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "${script_dir}/worktree-lib.sh"
SH
cat >"$S/worktree-lib.sh" <<'SH' || exit 2
# lib
. "$script_dir/deep-lib.sh"
SH
printf '# deep lib\n' >"$S/deep-lib.sh" || exit 2
printf '# lib 2\n' >"$S/second-lib.sh" || exit 2
printf '// pr-facts\n' >"$S/pr-facts.mjs" || exit 2
printf '# decoy\n' >"$S/decoy.sh" || exit 2
printf 'echo unguarded\n' >"$S/unguarded.sh" || exit 2
printf 'echo test\n' >"$S/fill-verdict.test.sh" || exit 2
cat >"$REPO/.claude/settings.json" <<'JSON' || exit 2
{
  "permissions": {
    "allow": [
      "Bash(bash .claude/scripts/fill-verdict.sh:*)",
      "Bash(bash .claude/scripts/edit-comment.sh:*)",
      "Bash(bash .claude/scripts/sweep-orphans.sh:*)",
      "Bash(gh issue comment:*)",
      "Bash(bash /abs/path.sh:*)"
    ]
  }
}
JSON
must git -C "$REPO" add -A
must git -C "$REPO" commit -q -m seed

export GUARD_SCRIPT_REPO="$REPO"
export GUARD_SCRIPT_REF=main
export GUARD_SCRIPT_SETTINGS="$REPO/.claude/settings.json"

# tree <name> -> $TMP_ROOT/<name>/.claude/scripts, a copy of the reference scripts.
tree() {
  must mkdir -p "$TMP_ROOT/$1/.claude"
  must cp -R "$S" "$TMP_ROOT/$1/.claude/scripts"
}
tree good
tree edited
tree libedited
tree deepedited
tree decoyedited
tree mjsedited
tree extra
tree untracked
printf '# edited\n' >>"$TMP_ROOT/edited/.claude/scripts/fill-verdict.sh" || exit 2
printf '# edited\n' >>"$TMP_ROOT/libedited/.claude/scripts/worktree-lib.sh" || exit 2
printf '# edited\n' >>"$TMP_ROOT/deepedited/.claude/scripts/deep-lib.sh" || exit 2
printf '# edited\n' >>"$TMP_ROOT/decoyedited/.claude/scripts/decoy.sh" || exit 2
printf '// edited\n' >>"$TMP_ROOT/mjsedited/.claude/scripts/pr-facts.mjs" || exit 2
printf '# edited\n' >>"$TMP_ROOT/extra/.claude/scripts/unguarded.sh" || exit 2
printf '# edited\n' >>"$TMP_ROOT/extra/.claude/scripts/fill-verdict.test.sh" || exit 2
# A planted copy in its own git repository whose own `main` matches it: the reference must not
# be read from the tree being judged.
tree planted
printf 'echo planted\n' >"$TMP_ROOT/planted/.claude/scripts/edit-comment.sh" || exit 2
must git init -q -b main "$TMP_ROOT/planted"
must git -C "$TMP_ROOT/planted" config user.email "harness@example.invalid"
must git -C "$TMP_ROOT/planted" config user.name "Harness"
must git -C "$TMP_ROOT/planted" add -A
must git -C "$TMP_ROOT/planted" commit -q -m planted
# A script absent from the reference: a settings rule for a script the branch adds.
tree newscript
must mkdir -p "$TMP_ROOT/newscript/.claude/scripts"
printf 'echo new\n' >"$TMP_ROOT/newscript/.claude/scripts/brand-new.sh" || exit 2
cat >"$TMP_ROOT/settings-new.json" <<'JSON' || exit 2
{ "permissions": { "allow": ["Bash(bash .claude/scripts/brand-new.sh:*)"] } }
JSON
# A rule naming a nested file, and a wildcard rule, which the hook does not guard.
must mkdir -p "$TMP_ROOT/newscript/.claude/scripts/sub"
printf 'echo nested\n' >"$TMP_ROOT/newscript/.claude/scripts/sub/nested.sh" || exit 2
cat >"$TMP_ROOT/settings-nested.json" <<'JSON' || exit 2
{ "permissions": { "allow": ["Bash(bash .claude/scripts/sub/nested.sh:*)"] } }
JSON
cat >"$TMP_ROOT/settings-wild.json" <<'JSON' || exit 2
{ "permissions": { "allow": ["Bash(bash .claude/scripts/fill-verdict.sh:*)", "Bash(bash .claude/scripts/*:*)"] } }
JSON
# A tree where the guarded script is a symlink out to an edited copy.
tree linked
must cp "$TMP_ROOT/edited/.claude/scripts/fill-verdict.sh" "$TMP_ROOT/linked-target.sh"
must rm "$TMP_ROOT/linked/.claude/scripts/fill-verdict.sh"
must ln -s "$TMP_ROOT/linked-target.sh" "$TMP_ROOT/linked/.claude/scripts/fill-verdict.sh"

# event <cwd|-> <command> -> a Bash PreToolUse event at $TMP_ROOT/event.json; `-` omits cwd.
event() {
  must node -e '
    const [, cwd, command] = process.argv;
    const ev = { tool_name: "Bash", tool_input: { command } };
    if (cwd !== "-") ev.cwd = cwd;
    process.stdout.write(JSON.stringify(ev));
  ' "$1" "$2" >"$TMP_ROOT/event.json"
}

# refuses <tree> <command> <stderr-substring> — exit 2, the reason on stderr, nothing on stdout.
refuses() {
  begin "refuses: [$1] $2"
  event "$TMP_ROOT/$1" "$2"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 2
  expect_stderr "$3"
  expect_stderr "guard-script-integrity: refused"
  expect_stderr "by absolute path"
  [ -z "$out" ] || bad "expected no stdout; got: $out"
  end
}

# passes <tree> <command> — exit 0, silent.
passes() {
  begin "passes: [$1] $2"
  event "$TMP_ROOT/$1" "$2"
  capture bash "$HOOK" <"$TMP_ROOT/event.json"
  expect_rc 0
  expect_silent
  end
}

# --- the named scripts against origin/main ------------------------------------------------

for s in fill-verdict edit-comment sweep-orphans; do
  passes good "bash .claude/scripts/$s.sh 1 --category c"
done
passes good 'bash ./.claude/scripts/fill-verdict.sh 1'
passes good 'bash -x .claude/scripts/fill-verdict.sh 1'
passes good 'FILL_VERDICT_VERIFY_CMD=true bash .claude/scripts/fill-verdict.sh 1'
passes edited 'bash .claude/scripts/unguarded.sh --verdict "bash .claude/scripts/fill-verdict.sh; x"'
refuses edited 'bash .claude/scripts/fill-verdict.sh 1' "$TMP_ROOT/edited/.claude/scripts/fill-verdict.sh: differs from main's .claude/scripts/fill-verdict.sh"
refuses edited 'bash ./.claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'bash -x .claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'bash .claude/scripts/../scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'FILL_VERDICT_VERIFY_CMD=true bash .claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'env X=1 bash .claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'sh .claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'source .claude/scripts/fill-verdict.sh' "differs from main"
refuses edited 'bash ".claude/scripts/fill-verdict.sh" 1' "differs from main"
refuses edited "bash '.claude/scripts/fill-verdict.sh' 1" "differs from main"
refuses edited 'bash -c "bash .claude/scripts/fill-verdict.sh 1"' "differs from main"
refuses edited 'echo hi; bash .claude/scripts/fill-verdict.sh 1' "differs from main"
refuses edited 'true && bash .claude/scripts/fill-verdict.sh 1 | tail -3' "differs from main"
refuses edited '(bash .claude/scripts/fill-verdict.sh 1)' "differs from main"
refuses edited 'bash .claude/scripts/fill-verdict.sh 1 &' "differs from main"
refuses edited 'bash .claude/scripts/fill-verdict.sh 1 >out 2>&1' "differs from main"
refuses planted 'bash .claude/scripts/edit-comment.sh 1 body' "differs from main"

# --- the files a script sources ------------------------------------------------------------

refuses libedited 'bash .claude/scripts/fill-verdict.sh 1' "worktree-lib.sh: differs from main"
refuses libedited 'bash .claude/scripts/sweep-orphans.sh' "worktree-lib.sh: differs from main"
refuses deepedited 'bash .claude/scripts/fill-verdict.sh 1' "deep-lib.sh: differs from main"
refuses mjsedited 'bash .claude/scripts/fill-verdict.sh 1' "pr-facts.mjs: differs from main"
passes libedited 'bash .claude/scripts/edit-comment.sh 1 body'
passes decoyedited 'bash .claude/scripts/fill-verdict.sh 1'
passes extra 'bash .claude/scripts/fill-verdict.sh 1'

# --- which tree the relative path names ---------------------------------------------------

refuses good "cd $TMP_ROOT/edited && bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "cd $TMP_ROOT/edited; bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "pushd $TMP_ROOT/edited && bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "(cd $TMP_ROOT/edited && bash .claude/scripts/fill-verdict.sh 1)" "differs from main"
refuses good "cd $TMP_ROOT/edited && (cd $TMP_ROOT/good); bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "cd $TMP_ROOT/edited && cd .claude/.. && bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "echo \$(cd $TMP_ROOT/edited && bash .claude/scripts/fill-verdict.sh 1)" "differs from main"
refuses good "bash -c 'cd $TMP_ROOT/edited && bash .claude/scripts/fill-verdict.sh 1'" "differs from main"
# A path that normalises to no rule's text is matched by no rule.
passes good "cd $TMP_ROOT/edited/.claude && bash ../.claude/scripts/fill-verdict.sh 1"
passes edited "cd $TMP_ROOT/good && bash .claude/scripts/fill-verdict.sh 1"
passes edited "(cd $TMP_ROOT/good); cd $TMP_ROOT/good && bash .claude/scripts/fill-verdict.sh 1"
passes edited "cd $TMP_ROOT/good && (cd $TMP_ROOT/edited); bash .claude/scripts/fill-verdict.sh 1"
passes edited "cd $TMP_ROOT/good && cd .. && cd good && bash .claude/scripts/fill-verdict.sh 1"
passes edited "cd $TMP_ROOT && cd good && bash .claude/scripts/fill-verdict.sh 1"
passes edited "cd $TMP_ROOT && bash .claude/scripts/fill-verdict.sh 1"
# A `cd` after `&&` or `||` may not have run, so the script is judged in both directories.
refuses edited "true || cd $TMP_ROOT/good; bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses edited "false && cd $TMP_ROOT/good; bash .claude/scripts/fill-verdict.sh 1" "differs from main"
refuses good "false && cd $TMP_ROOT/edited; bash .claude/scripts/fill-verdict.sh 1" "differs from main"
passes good "true || cd $TMP_ROOT/good; bash .claude/scripts/fill-verdict.sh 1"

# --- what it cannot resolve fails closed, only for a guarded script ----------------------------

refuses good 'cd - && bash .claude/scripts/fill-verdict.sh 1' "working directory is not known"
refuses good 'popd; bash .claude/scripts/fill-verdict.sh 1' "working directory is not known"
refuses good 'bash .claude/scripts/fill-verdict.sh* 1' "cannot be resolved"
passes good 'bash .claude/scripts/fill-verdict.s* 1'
passes good 'bash /abs/elsewhere/.claude/scripts/fill-verdict.sh 1'
passes edited "bash $TMP_ROOT/edited/.claude/scripts/fill-verdict.sh 1"
passes edited "bash $TMP_ROOT/edited/.claude/scripts/fill-verdict.sh 1 ; true"

# --- scripts and rules the guard does not own ----------------------------------------------

passes edited 'bash .claude/scripts/unguarded.sh'
passes edited 'bash .claude/scripts/fill-verdict.test.sh'
passes edited 'bash .claude/scripts/fill-verdict.sh.bak'
passes edited 'cat .claude/scripts/fill-verdict.sh'
passes edited 'git diff origin/main -- .claude/scripts/fill-verdict.sh'
passes edited 'echo bash .claude/scripts/fill-verdict.sh'
passes edited 'gh issue comment 1 --repo x/y --body-file .claude/scripts/fill-verdict.sh'
passes edited 'ls .claude/scripts # bash .claude/scripts/fill-verdict.sh'
passes edited 'bash /abs/path.sh'

# --- rows holding a literal `$` or backtick, which shellcheck reads as a mistaken expansion ----
# verdict, tree, the stderr substring (`-` for a pass), then the command to the end of the line.
while IFS=$'\t' read -r verdict tree key row; do
  case $verdict in
    refuses) refuses "$tree" "$row" "$key" ;;
    passes) passes "$tree" "$row" ;;
    *)
      printf 'FATAL harness row has no verdict: %s\n' "$verdict" >&2
      exit 2
      ;;
  esac
done <<'ROWS'
refuses	edited	differs from main	echo $(bash .claude/scripts/fill-verdict.sh 1)
refuses	edited	differs from main	echo "$(bash .claude/scripts/fill-verdict.sh 1)"
refuses	edited	differs from main	echo `bash .claude/scripts/fill-verdict.sh 1`
refuses	edited	differs from main	echo `cd /tmp`; bash .claude/scripts/fill-verdict.sh 1
refuses	edited	differs from main	bash .claude//scripts/fill-verdict.sh 1
refuses	edited	differs from main	bash .cla''ude/scripts/fill-verdict.sh 1
refuses	edited	differs from main	bash .claude"/"scripts/fill-verdict.sh 1
refuses	edited	differs from main	bash .claude/scr\ipts/fill-verdict.sh 1
refuses	good	working directory is not known	cd "$WT" && bash .claude/scripts/fill-verdict.sh 1
refuses	good	working directory is not known	cd $(mktemp -d) && bash .claude/scripts/fill-verdict.sh 1
refuses	good	cannot be resolved	bash .claude/scripts/fill-verdict.sh$X 1
refuses	good	cannot be resolved	bash ".claude/scripts/fill-verdict.sh$X" 1
passes	good	-	bash "$WT/.claude/scripts/fill-verdict.sh" 1
passes	good	-	bash ".claude/scripts/$name.sh"
passes	good	-	cd "$WT" && bash .claude/scripts/unguarded.sh
passes	good	-	cd "$WT" && git status
passes	good	-	bash "$WT/scripts/other.sh"
passes	edited	-	bash "/$X/.claude/scripts/fill-verdict.sh" 1
ROWS

begin "refuses: a symlink out to an edited copy is judged by its bytes"
event "$TMP_ROOT/linked" 'bash .claude/scripts/fill-verdict.sh 1'
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "differs from main"
end

begin "refuses: a script named by a rule but absent from the reference"
event "$TMP_ROOT/newscript" 'bash .claude/scripts/brand-new.sh'
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/settings-new.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "brand-new.sh is not on main"
end

begin "refuses: a rule naming a nested file guards it"
event "$TMP_ROOT/newscript" 'bash .claude/scripts/sub/nested.sh'
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/settings-nested.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "sub/nested.sh is not on main"
end

begin "passes: a wildcard rule is not guarded (the hook header's stated limit)"
event "$TMP_ROOT/edited" 'bash .claude/scripts/*.sh'
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/settings-wild.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
end

begin "the shipped settings.json holds no wildcard script rule, which the hook cannot guard"
if node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).permissions.allow; process.exit(a.some((r)=>/^Bash\(bash \.claude\/scripts\/[^:]*\*/.test(r))?1:0)' "$SCRIPTS/../settings.json"; then :; else bad "a wildcard Bash(bash .claude/scripts/…) rule is in settings.json"; fi
end

begin "the guarded set is read from settings.json: a rule added there guards its script"
event "$TMP_ROOT/extra" 'bash .claude/scripts/unguarded.sh'
printf '{"permissions":{"allow":["Bash(bash .claude/scripts/unguarded.sh:*)"]}}' >"$TMP_ROOT/settings-unguarded.json" || exit 2
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/settings-unguarded.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "differs from main"
end

begin "a settings.json with no matching rule guards nothing"
event "$TMP_ROOT/edited" 'bash .claude/scripts/fill-verdict.sh 1'
printf '{"permissions":{"allow":["Bash(gh issue comment:*)"]}}' >"$TMP_ROOT/settings-none.json" || exit 2
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/settings-none.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

# --- the hook cannot judge ----------------------------------------------------------------------

begin "an unreadable settings.json is exit 1 and names the file"
event "$TMP_ROOT/edited" 'bash .claude/scripts/fill-verdict.sh 1'
GUARD_SCRIPT_SETTINGS="$TMP_ROOT/no-such-settings.json" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "could not read $TMP_ROOT/no-such-settings.json"
end

begin "a reference that is not a revision is refused for a guarded script"
event "$TMP_ROOT/good" 'bash .claude/scripts/fill-verdict.sh 1'
GUARD_SCRIPT_REF=no-such-ref capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "no-such-ref is not readable"
end

begin "a reference that is not a revision does not touch a call that names no guarded script"
event "$TMP_ROOT/good" 'bash .claude/scripts/unguarded.sh'
GUARD_SCRIPT_REF=no-such-ref capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

mkdir -p "$TMP_ROOT/bin" || exit 2
printf '#!/bin/sh\nexit 126\n' >"$TMP_ROOT/bin/git-unspawnable" || exit 2
printf '#!/bin/sh\nexit 3\n' >"$TMP_ROOT/bin/node-crash" || exit 2
chmod +x "$TMP_ROOT/bin/git-unspawnable" "$TMP_ROOT/bin/node-crash" || exit 2

begin "a git that cannot read the reference is refused for a guarded script"
event "$TMP_ROOT/good" 'bash .claude/scripts/fill-verdict.sh 1'
HOOK_GIT_CMD="$TMP_ROOT/bin/git-unspawnable" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "is not readable"
end

begin "a missing git is exit 1 and names the tool"
event "$TMP_ROOT/good" 'bash .claude/scripts/fill-verdict.sh 1'
HOOK_GIT_CMD="$TMP_ROOT/bin/no-such-git" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-script-integrity: required tool not found: $TMP_ROOT/bin/no-such-git"
end

begin "a missing interpreter is exit 1 and names the tool"
event "$TMP_ROOT/good" 'bash .claude/scripts/fill-verdict.sh 1'
HOOK_NODE_CMD="$TMP_ROOT/bin/no-such-node" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "guard-script-integrity: required tool not found: $TMP_ROOT/bin/no-such-node"
end

begin "a crashing interpreter is exit 1, not a refusal"
event "$TMP_ROOT/edited" 'bash .claude/scripts/fill-verdict.sh 1'
HOOK_NODE_CMD="$TMP_ROOT/bin/node-crash" capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 1
expect_stderr "exited non-zero"
end

begin "an unparseable event that names a script passes silently"
printf '{"tool_input": .claude/scripts/fill-verdict.sh' >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "an event with no command string passes silently"
printf '{"tool_input": {"file_path": ".claude/scripts/fill-verdict.sh"}, "cwd": "%s"}' "$TMP_ROOT/edited" >"$TMP_ROOT/event.json" || exit 2
capture bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "an empty cwd in the event falls back to the hook's own working directory"
event '' 'bash .claude/scripts/fill-verdict.sh 1'
capture -C "$TMP_ROOT/edited" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 2
expect_stderr "differs from main"
end

begin "no cwd in the event falls back to the hook's own working directory"
event - 'bash .claude/scripts/fill-verdict.sh 1'
capture -C "$TMP_ROOT/good" bash "$HOOK" <"$TMP_ROOT/event.json"
expect_rc 0
expect_silent
end

begin "the shipped settings.json wires the hook beside the rules it guards"
shipped=$(cd "$SCRIPTS/../.." && pwd) || exit 2
fixture_has "$shipped/.claude/settings.json" '.claude/hooks/guard-script-integrity.sh'
fixture_has "$shipped/.claude/settings.json" 'Bash(bash .claude/scripts/fill-verdict.sh:*)'
end

begin "the hook parses under every bash on the box"
expect_parses "$HOOK"
end

finish
