#!/usr/bin/env bash
# Test harness for the lane-report field check in pr-facts.mjs, its neighbour in this directory (#671).
#
# merge-pr.test.sh proves the refusal end to end; this harness proves the reader on its own, fast:
# the field list it derives from the template block in .claude/agents/ticket-agent.md, the
# `lanemissing` records for a body that lacks a field, and its refusal to pass a report it cannot
# check. EXPECTED is harness-lib.sh's lane_report_labels, which the cases below prove against the template.
#
# Usage: bash .claude/scripts/pr-facts.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
FACTS="$SCRIPTS/pr-facts.mjs"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

EXPECTED=()
while IFS= read -r l; do EXPECTED+=("$l"); done < <(lane_report_labels)

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
printf '{"body":"## Lane report — issue #21\\nSubreview: x\\nXReview: x"}' >"$TMP_ROOT/embedded.json"
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
expect_stdout 'lanetemplate	cannot read'
end

begin "a template with no lane-report block is flagged rather than passed"
must mkdir -p "$TMP_ROOT/blockless/scripts" "$TMP_ROOT/blockless/agents"
must cp "$FACTS" "$TMP_ROOT/blockless/scripts/"
printf 'no template here\n' >"$TMP_ROOT/blockless/agents/ticket-agent.md"
facts_of "$TMP_ROOT/full2.json" "$TMP_ROOT/blockless/scripts/pr-facts.mjs"
expect_stdout 'lanetemplate	no lane-report template block found'
end

# template_case <dir> <template text> -> a copy of pr-facts.mjs with its own agents/ticket-agent.md.
template_case() {
  must mkdir -p "$TMP_ROOT/$1/scripts" "$TMP_ROOT/$1/agents"
  must cp "$FACTS" "$TMP_ROOT/$1/scripts/"
  printf '%s\n' "$2" >"$TMP_ROOT/$1/agents/ticket-agent.md"
}

begin "a template holding STATUS: but no report header is flagged rather than read from line 0"
template_case nostart 'Alpha: x
STATUS: DONE'
facts_of "$TMP_ROOT/full2.json" "$TMP_ROOT/nostart/scripts/pr-facts.mjs"
expect_stdout 'lanetemplate	no lane-report template block found'
end

begin "an indented line in the template block is a continuation, never a label"
template_case indented '## Lane report — issue #<n>
Alpha: x
      Indented: y
STATUS: DONE'
printf '{"body":"## Lane report — issue #21\\nAlpha: x\\nSTATUS: DONE"}' >"$TMP_ROOT/indented.json"
facts_of "$TMP_ROOT/indented.json" "$TMP_ROOT/indented/scripts/pr-facts.mjs"
expect_not_stdout 'lanemissing'
end

# filled_template <extra body text> -> a JSON PR object whose body is the live lane-report template
# with every `<...>` placeholder (and a `#<...>` reference) replaced by the issue reference #703,
# the worst filling for a closing-keyword check: whatever verb the template puts before a
# placeholder then sits before an issue number (#720). A failing filling is the template's to reword.
filled_template() {
  EXTRA="$1" capture node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const t = readFileSync(process.argv[1], "utf8").replace(/\r\n?/g, "\n").split("\n");
    const start = t.findIndex((l) => l.startsWith("## Lane report — issue #<n>"));
    const end = t.findIndex((l, i) => i > start && l.startsWith("STATUS:"));
    const block = t.slice(start, end + 1).join("\n").replace(/#?<[^>]*>/g, "#703");
    process.stdout.write(JSON.stringify({ title: "#21: the change", number: 490, body: "Closes #21.\n" + block + (process.env.EXTRA || "") }));
  ' "$SCRIPTS/../agents/ticket-agent.md"
}

begin "the template filled with issue references yields no stray closing reference"
filled_template ''
expect_rc 0 "$rc"
printf '%s' "$out" >"$TMP_ROOT/filled.json"
facts_of "$TMP_ROOT/filled.json"
expect_rc 0 "$rc"
expect_stdout "lane	703"
expect_not_stdout "stray"
expect_not_stdout "lanemissing"
end

begin "...and the same body passes --squash-message"
capture node "$FACTS" --squash-message <"$TMP_ROOT/filled.json"
expect_rc 0 "$rc"
end

begin "control: a filled field that puts a closing verb before an issue reference is a stray record"
filled_template '\nDiscovered, not fixed: #703'
printf '%s' "$out" >"$TMP_ROOT/filled-bad.json"
facts_of "$TMP_ROOT/filled-bad.json"
expect_stdout "stray"
end

finish
