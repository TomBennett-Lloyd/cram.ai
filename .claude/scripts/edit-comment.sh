#!/usr/bin/env bash
#
# Replaces the body of one existing issue or PR conversation comment on this repository with the
# contents of a file. It is the sanctioned route for a comment edit (docs/standards/evidence.md
# § Host conventions member 8):
# the allow rule in .claude/settings.json names this script alone, because a rule for `gh api`
# would also permit every other write that command can make (#677).
#
# The repository is fixed below and not a parameter, and the comment is named by a bare numeric
# id, so the only thing a caller chooses is which comment of this repo gets which text.
#
# Usage: edit-comment.sh <comment-id> <body-file>
# Exit:  0 the comment was edited, 1 gh refused or failed, 2 usage or an unreadable body.
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

REPO='TomBennett-Lloyd/cram.ai'
: "${EDIT_COMMENT_GH_CMD:=gh}" # GitHub CLI; the seam the harness stubs

usage() {
  echo "usage: edit-comment.sh <comment-id> <body-file>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
comment_id=$1
body_file=$2

case "$comment_id" in
  '' | *[!0-9]*)
    echo "edit-comment: comment id must be all digits, got: $comment_id" >&2
    exit 2
    ;;
esac
[ -f "$body_file" ] && [ -s "$body_file" ] && [ ! -L "$body_file" ] || {
  echo "edit-comment: body file missing, empty or a symlink: $body_file" >&2
  exit 2
}

"$EDIT_COMMENT_GH_CMD" api --method PATCH "repos/$REPO/issues/comments/$comment_id" -F "body=@$body_file" --jq '.html_url' || exit 1
