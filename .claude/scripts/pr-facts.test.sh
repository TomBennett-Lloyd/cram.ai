#!/usr/bin/env bash
# Test harness for the lane-report field check in pr-facts.mjs, its neighbour in this directory (#671).
#
# merge-pr.test.sh proves the refusal end to end; this harness proves the reader on its own, fast:
# the field list it derives from the template block in .claude/agents/ticket-agent.md, the
# `lanemissing` records for a body that lacks a field, and its refusal to pass a report it cannot
# check. EXPECTED is this harness's copy of the template's labels, in template order.
#
# Usage: bash .claude/scripts/pr-facts.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
FACTS="$SCRIPTS/pr-facts.mjs"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

EXPECTED=(
  'Branch/HEAD' 'PR' 'CI' 'Verify' 'Plan comment' 'Footprint drift vs plan comment'
  'Changed files' 'Review' 'Mutation' 'Classification' 'Extras beyond the approved plan'
  'Lane model' 'Sub-dispatches' 'Consultant' 'Discovered' 'Cross-references' 'Retro'
  'Merge cautions' 'STATUS'
)

# body_with <skipped label or ''> -> a JSON PR object whose body is a lane report holding every
# EXPECTED label but the skipped one, each value `x`. Labels that share a line in the template (CI, Footprint drift, Consultant,
# Cross-references) are separate EXPECTED entries, so the per-label cases below prove the template's
# same-line labels are read apart.
body_with() {
  local skip="$1" text="Closes #21.\\n## Lane report — issue #21" l
  for l in "${EXPECTED[@]}"; do
    [ "$l" = "$skip" ] || text="$text\\n$l: x"
  done
  printf '{"body":"%s"}' "$text"
}

facts_of() { # facts_of <json file> [script] -> capture node <script> < file
  capture node "${2:-$FACTS}" <"$1"
}

begin "pr-facts.mjs parses (node --check)"
capture node --check "$FACTS"
expect_rc 0 "$rc"
end

begin "a report holding every template label yields no lanemissing record"
body_with '' >"$TMP_ROOT/full.json"
facts_of "$TMP_ROOT/full.json"
expect_rc 0 "$rc"
expect_not_stdout 'lanemissing'
end

for label in "${EXPECTED[@]}"; do
  begin "a report without '$label:' yields exactly that lanemissing record"
  body_with "$label" >"$TMP_ROOT/one.json"
  facts_of "$TMP_ROOT/one.json"
  expect_rc 0 "$rc"
  expect_stdout "lanemissing	$label"
  count=$(printf '%s\n' "$out" | grep -c '^lanemissing')
  [ "$count" = "1" ] || bad "expected one lanemissing record, got $count"
  end
done

begin "a label inside a word is not the label"
printf '{"body":"## Lane report — issue #21\\nSubreview: x"}' >"$TMP_ROOT/embedded.json"
facts_of "$TMP_ROOT/embedded.json"
expect_stdout "lanemissing	Review"
end

begin "a label above the report header does not count"
printf '{"body":"STATUS: DONE\\n## Lane report — issue #21\\nPR: x"}' >"$TMP_ROOT/above.json"
facts_of "$TMP_ROOT/above.json"
expect_stdout "lanemissing	STATUS"
end

begin "a body with no lane report yields no lanemissing record"
printf '{"body":"Closes #21.\\nProse only."}' >"$TMP_ROOT/none.json"
facts_of "$TMP_ROOT/none.json"
expect_rc 0 "$rc"
expect_not_stdout 'lanemissing'
end

begin "a batch TASK REPORT body yields no lanemissing record"
printf '{"body":"## TASK REPORT — batch: anchor #21, members #21 #22"}' >"$TMP_ROOT/batch.json"
facts_of "$TMP_ROOT/batch.json"
expect_not_stdout 'lanemissing'
end

begin "without the template beside it, a lane report is flagged rather than passed"
must mkdir -p "$TMP_ROOT/alone/scripts"
must cp "$FACTS" "$TMP_ROOT/alone/scripts/"
body_with '' >"$TMP_ROOT/full2.json"
facts_of "$TMP_ROOT/full2.json" "$TMP_ROOT/alone/scripts/pr-facts.mjs"
expect_rc 0 "$rc"
expect_stdout 'lane-report template unreadable'
end

begin "a template with no lane-report block is flagged rather than passed"
must mkdir -p "$TMP_ROOT/blockless/scripts" "$TMP_ROOT/blockless/agents"
must cp "$FACTS" "$TMP_ROOT/blockless/scripts/"
printf 'no template here\n' >"$TMP_ROOT/blockless/agents/ticket-agent.md"
facts_of "$TMP_ROOT/full2.json" "$TMP_ROOT/blockless/scripts/pr-facts.mjs"
expect_stdout 'no lane-report template block found'
end

finish
