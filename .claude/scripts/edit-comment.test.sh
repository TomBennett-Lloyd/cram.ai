#!/usr/bin/env bash
# Test harness for edit-comment.sh. `gh` is stubbed through the subject's env seam; every refusal
# case asserts the stub was never called.
#
# Usage: bash .claude/scripts/edit-comment.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
SUBJECT=${EDIT_COMMENT_SCRIPT:-$SCRIPTS/edit-comment.sh}
# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

STUB="$TMP_ROOT/stub"
must mkdir -p "$STUB"
cat >"$STUB/gh" <<'STUB_EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/calls.log"
echo "https://github.com/stub/comment"
exit "${STUB_RC:-0}"
STUB_EOF
must chmod +x "$STUB/gh"
export STUB_DIR="$STUB" EDIT_COMMENT_GH_CMD="$STUB/gh"

BODY="$TMP_ROOT/body.md"
printf '## Plan\n' >"$BODY"
: >"$TMP_ROOT/empty.md"

run() { # run <args...> — the subject with the stub's call log reset
  rm -f "$STUB/calls.log"
  capture bash "$SUBJECT" "$@"
}
expect_no_call() { [ ! -e "$STUB/calls.log" ] || bad "gh was called: $(cat "$STUB/calls.log")"; }

begin 'parses under every bash'
expect_parses "$SUBJECT"
end

begin 'edits the named comment of the fixed repository from the file'
run 6705619084 "$BODY"
expect_rc 0
expect_stdout 'https://github.com/stub/comment'
[ "$(cat "$STUB/calls.log")" = "api --method PATCH repos/TomBennett-Lloyd/cram.ai/issues/comments/6705619084 -F body=@$BODY --jq .html_url" ] ||
  bad "call was: $(cat "$STUB/calls.log")"
end

begin 'a gh failure is the exit code 1 of the script'
rm -f "$STUB/calls.log"
capture env STUB_RC=1 bash "$SUBJECT" 5 "$BODY"
expect_rc 1
end

for badid in 'abc' '12a' '../1' '1/2' '-1' '1 2' ''; do
  begin "refuses the comment id '$badid'"
  run "$badid" "$BODY"
  expect_rc 2
  expect_stderr 'all digits'
  expect_no_call
  end
done

begin 'refuses a missing body file'
run 5 "$TMP_ROOT/nope.md"
expect_rc 2
expect_stderr 'missing or empty'
expect_no_call
end

begin 'refuses an empty body file'
run 5 "$TMP_ROOT/empty.md"
expect_rc 2
expect_stderr 'missing or empty'
expect_no_call
end

begin 'refuses a wrong argument count'
run 5
expect_rc 2
expect_stderr 'usage'
run 5 "$BODY" extra
expect_rc 2
expect_no_call
end

finish
