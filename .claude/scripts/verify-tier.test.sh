#!/usr/bin/env bash
# Test harness for verify-tier.sh, its neighbour in this directory.
#
# The assertion vocabulary is harness-lib.sh next door; the fixtures are real
# git repositories — a bare origin plus a clone of it — built the way
# worktree-lifecycle.test.sh builds its own, because the subject's whole input is
# what git says about a tree and a stub for that is a stub for the thing under
# test.
#
# Every case runs the classifier with --dry-run, so no case ever executes a gate.
# What is asserted is the tier and the leg list the classifier says it would run;
# the delegation itself is one `pnpm <script>` line, and a harness that ran the
# real composite per case would take an hour to say so.
#
# That is also the limit of what the source-prose cases can claim. Whether the
# compiler goes red on a `@ts-expect-error` hidden in a comment is tsc's verdict,
# not this classifier's; what belongs here is that the emit proof did not see the
# pragma — so the tier still comes out source-prose — and that `pnpm typecheck`
# is in the leg list, which is the only way that verdict can ever be reached. The
# red itself is evidence on the PR, run against this repository.
#
# The bias every case is written against: this script can only be wrong in one
# direction. Classifying a markdown-only change as full costs a slow run;
# classifying anything else as docs skips gates that could have caught a defect.
# So the docs-tier cases assert the exact leg list (a docs tier that quietly
# gained `pnpm test` would still say "docs"), and every fail-closed case asserts
# rc AND the reason, because a tier that came out full for the wrong reason is a
# case that will stop covering anything the day the reason changes. The
# source-prose cases inherit both: one asserts its whole leg list, and the
# selection cases name the observing tests they expect rather than counting them.
#
# The emit proof needs an esbuild binary, and the fixtures have no node_modules
# of their own — the classifier resolves one from the repository holding it,
# which is this one. Where that repository has no node_modules at all, the cases
# that need it print SKIP with the reason and are counted as skipped, never as
# passed. Where node_modules exists without esbuild they FAIL: that is the
# devDependency gone missing, and rung 2 silently always-full (#30). The
# no-binary fallback case runs a copy of the classifier held outside any
# repository, so it runs either way.
#
# Every fixture carries a *.test.ts file in its base commit, and not for
# decoration: the soundness guard refuses to certify a change set it could not
# check against anything, so a fixture with no test files would take the
# fail-closed path and the docs tier would be unreachable for reasons that have
# nothing to do with the case. One case removes it deliberately, to assert that
# refusal.
#
# One case runs the classifier against the REAL repository with no argument:
# every other case pins it to a fixture, so without it the shipped default path
# — the one `pnpm verify` actually takes — could be broken and the suite would
# still be green (testing.md rule 7).
#
# Usage: bash .claude/scripts/verify-tier.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
TIER="$SCRIPTS/verify-tier.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

DOCS_LEGS="pnpm check:adr-index && pnpm check:ledgers && pnpm check:no-course-content && pnpm check:markdown-links && pnpm format:check"

# Whether esbuild is installed is decided from what sits in node_modules, never from
# verify-tier.sh's own lookup: a lookup that broke while esbuild is installed must red the
# cases that need it, not skip them.
TOOL_REPO=$(git -C "$SCRIPTS" rev-parse --show-toplevel 2>/dev/null) || TOOL_REPO=""
esbuild_installed() {
  local candidate
  [ -n "$TOOL_REPO" ] || return 1
  for candidate in "$TOOL_REPO/node_modules/.bin/esbuild" \
    "$TOOL_REPO/node_modules/.pnpm/node_modules/.bin/esbuild" \
    "$TOOL_REPO/node_modules/esbuild/bin/esbuild" \
    "$TOOL_REPO"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild; do
    [ -e "$candidate" ] && return 0
  done
  return 1
}
if esbuild_installed; then
  HAVE_ESBUILD=1
else
  HAVE_ESBUILD=0
fi
skipped=0

# begin_with_esbuild <name> -> begins the case and returns 0 when esbuild is installed here.
# Otherwise returns 1, so the body never runs: a FAIL when node_modules is installed without
# esbuild, a SKIP with the reason when nothing is installed. Written
# `if begin_with_esbuild …; then … end; fi`.
begin_with_esbuild() {
  begin "$1"
  [ "$HAVE_ESBUILD" = 1 ] && return 0
  if [ -n "$TOOL_REPO" ] && [ -d "$TOOL_REPO/node_modules" ]; then
    bad "node_modules is installed but holds no esbuild, the root devDependency rung 2 runs"
    end
    return 1
  fi
  printf 'SKIP %s — no node_modules under %s, so no esbuild to prove an emit with\n' \
    "$1" "${TOOL_REPO:-<no repository>}"
  skipped=$((skipped + 1))
  return 1
}

ROOT=""
WT=""

# --- fixtures ----------------------------------------------------------------------------

# Identity is passed per-command: the harness must not depend on (or write) any git config.
gitc() {
  local dir="$1"
  shift
  git -C "$dir" -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"
}

# fixture <name> -> sets ROOT to a fresh $TMP_ROOT/<name> holding a bare origin and WT to a
# clone of it, one commit deep on main. The base commit holds a markdown file, a source file
# and a test file, so a case can change any of the three without also creating it.
#
# The fixture's markdown basenames are deliberately unlike any this repository holds
# (`tier-fixture-*.md`): the guard matches basenames, so a fixture named README.md would
# assert nothing about the guard that the repository's own tree did not already decide.
fixture() {
  ROOT="$TMP_ROOT/$1"
  WT="$ROOT/wt"
  must mkdir -p "$ROOT"
  must git init --quiet --bare -b main "$ROOT/origin.git"
  must git init --quiet -b main "$ROOT/seed"
  must mkdir -p "$ROOT/seed/docs" "$ROOT/seed/src"
  must printf 'node_modules/\n' >"$ROOT/seed/.gitignore"
  must printf '# Guide\n' >"$ROOT/seed/docs/tier-fixture-guide.md"
  must printf 'export const a = 1;\n' >"$ROOT/seed/src/app.ts"
  must printf "it('works', () => {});\n" >"$ROOT/seed/src/app.test.ts"
  must gitc "$ROOT/seed" add -A
  must gitc "$ROOT/seed" commit --quiet -m base
  must gitc "$ROOT/seed" remote add origin "$ROOT/origin.git"
  must gitc "$ROOT/seed" push --quiet origin main
  must rm -rf "$ROOT/seed"
  must git clone --quiet "$ROOT/origin.git" "$WT"
}

write_in() { # write_in <path under the worktree> <line>
  must mkdir -p "$(dirname "$WT/$1")"
  must printf '%s\n' "$2" >"$WT/$1"
}

commit_all() { # commit_all <message> — a commit on the branch, never pushed
  must gitc "$WT" add -A
  must gitc "$WT" commit --quiet -m "$1"
}

# seed_origin <message> — commit AND publish, so what was just written lands in the merge-base
# instead of the change set. Every case that needs a test file to already say something, or a
# workspace package to already exist, needs it invisible to the classifier's diff.
seed_origin() {
  commit_all "$1"
  must gitc "$WT" push --quiet origin main
}

run_tier() { # run_tier — the production invocation, --dry-run, against $WT
  capture bash "$TIER" --dry-run "$WT"
}

# ==========================================================================================
# 1. the classifier parses
# ==========================================================================================
begin "verify-tier.sh parses (bash -n)"
expect_parses "$TIER"
end

# ==========================================================================================
# 2. the real repo, via the shipped default path (no argument)
# ==========================================================================================
# The production configuration: no REPO_ROOT argument, so this is the only case that can
# catch a broken default root resolution — and it is what `pnpm verify` actually runs. It
# asserts the shape of the verdict rather than which tier came out, because the tier depends
# on the working tree the suite happens to run in and a case that demanded one would be a
# case that fails on a clean checkout or on a dirty one, at random.
begin "the real repository classifies with no argument, and names a tier and its legs"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$TIER" --dry-run
  expect_rc 0 "$rc"
  expect_stdout "verify tier: "
  expect_stdout "verify tier: dry run — would run: "
  expect_not_out "unbound variable"
  expect_not_out "No such file"
done
case_ctx=""
end

# ==========================================================================================
# 3. THE SAVING: markdown-only change sets, from each of the three sources
# ==========================================================================================
# The change set has three parts and no single git command reports all of them, so each part
# gets its own case: drop one of the three collections and exactly one of these goes red —
# and, worse than red, an uncollected part would make a mixed change set look markdown-only.
begin "an edited markdown file alone is the docs tier, and runs only the markdown-observing gates"
must fixture edited_md
write_in docs/tier-fixture-guide.md '# Guide, revised'
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$TIER" --dry-run "$WT"
  expect_rc 0 "$rc"
  expect_stdout "verify tier: docs — 1 file(s)"
  expect_stdout "docs/tier-fixture-guide.md"
  expect_stdout "would run: $DOCS_LEGS"
  expect_not_out "verify:full"
  expect_not_out "unbound variable"
done
case_ctx=""
end

begin "an untracked markdown file alone is the docs tier"
must fixture untracked_md
write_in docs/tier-fixture-note.md '# Note'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_stdout "docs/tier-fixture-note.md"
expect_stdout "would run: $DOCS_LEGS"
end

begin "markdown committed on the branch since the merge-base is the docs tier"
must fixture committed_md
write_in docs/tier-fixture-guide.md '# Guide, revised'
commit_all 'docs: revise the guide'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_stdout "docs/tier-fixture-guide.md"
expect_not_out "verify:full"
end

# A deletion is a change to a markdown file like any other, and the gate that can observe it
# is check-markdown-links — a link into the deleted file is exactly what breaks. The path is
# in the change set while the file is not on disk, which is the shape that would trip a
# classifier that stat'ed paths instead of reading git's answer.
begin "a deleted markdown file is still the docs tier"
must fixture deleted_md
must gitc "$WT" rm --quiet docs/tier-fixture-guide.md
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_stdout "docs/tier-fixture-guide.md"
end

# Line-based parsing of git's output is only safe while a path stays on one line. A space is
# the everyday version of that question and the one a docs directory actually meets.
begin "a markdown path containing a space is still classified, and still the docs tier"
must fixture spaced_md
write_in 'docs/tier fixture spaced.md' '# Spaced'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_stdout "docs/tier fixture spaced.md"
end

begin "several markdown files, from different sources, are one docs-tier change set"
must fixture many_md
write_in docs/tier-fixture-guide.md '# Guide, revised'
commit_all 'docs: revise the guide'
write_in docs/tier-fixture-note.md '# Note'
write_in docs/tier-fixture-more.md '# More'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 3 file(s)"
expect_stdout "docs/tier-fixture-guide.md"
expect_stdout "docs/tier-fixture-note.md"
expect_stdout "docs/tier-fixture-more.md"
end

# ==========================================================================================
# 4. anything else is the full composite
# ==========================================================================================
if begin_with_esbuild "a source file whose emit changed is the full tier, and the offending path is named"; then
  must fixture edited_ts
  write_in src/app.ts 'export const a = 2;'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: full"
  expect_stdout "the minified emit changed — src/app.ts"
  expect_stdout "would run: pnpm verify:full"
  expect_not_stdout "verify tier: docs"
  expect_not_stdout "verify tier: source-prose"
  end
fi

# The case the docs tier exists to get right in the dangerous direction: markdown present, so
# a classifier that asked "does this touch markdown" instead of "is this ALL markdown" would
# skip the compiler and the tests over a source edit. The source-prose rung does not rescue
# it either — that rung's question is about the emit, and this emit moved.
if begin_with_esbuild "markdown plus a source file whose emit changed is the full tier"; then
  must fixture mixed
  write_in docs/tier-fixture-guide.md '# Guide, revised'
  write_in src/app.ts 'export const a = 2;'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: full — 2 file(s)"
  expect_stdout "the minified emit changed — src/app.ts"
  expect_not_stdout "verify tier: docs"
  expect_not_stdout "verify tier: source-prose"
  end
fi

# Case matters, and this is the fail-closed direction: prettier and the link checker are
# configured for the extension this repository actually writes, so a .MD file is not
# self-evidently covered by the docs tier's gates — and no esbuild loader claims it
# either, so the source-prose rung cannot take it. It gets the composite.
if begin_with_esbuild "an upper-case .MD extension is not the docs tier"; then
  must fixture upper_md
  write_in docs/TIER-FIXTURE.MD '# Shouty'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: full"
  expect_stdout "neither markdown nor a source type the emit proof handles — docs/TIER-FIXTURE.MD"
  end
fi

begin "an empty change set is the full tier, not a free pass"
must fixture clean
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full — the change set is empty"
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "verify tier: docs"
end

# ==========================================================================================
# 5. THE SECOND RUNG: a source edit that changed no emitted code
# ==========================================================================================
# The rung's claim is "this edit changed no emitted code", proven by minifying the merge-base
# blob and the working file and comparing bytes. Section 4 above holds its refutations — a
# moved token, an unhandled extension — so what these cases own is the positive answer and
# what it buys: the tier line, the legs that can still see a comment, and the observing set.
#
# The fail-closed path for a checkout with no esbuild binary is the first case below. It
# runs a copy of the classifier from a directory no repository contains, so its TOOLROOT is
# empty and find_esbuild searches only the fixture's missing node_modules; the
# ceiling stops git finding a repository above $TMP_ROOT if $TMPDIR sits inside one.

begin "with no esbuild reachable, a comment-only edit is the full tier, and the reason names esbuild"
must fixture no_esbuild
must mkdir -p "$ROOT/tool"
must cp "$TIER" "$ROOT/tool/verify-tier.sh"
write_in src/app.ts 'export const a = 1; // now with a note'
capture env GIT_CEILING_DIRECTORIES="$ROOT" bash "$ROOT/tool/verify-tier.sh" --dry-run "$WT"
expect_rc 0 "$rc"
expect_stdout "verify tier: full — 1 file(s); no esbuild binary under node_modules to prove an unchanged emit with"
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "verify tier: source-prose"
end

if begin_with_esbuild "a comment-only .ts edit is the source-prose tier, and runs exactly the legs that can see a comment"; then
  must fixture comment_only_ts
  write_in src/app.ts 'export const a = 1; // now with a note'
  for interpreter in $BASHES; do
    case_ctx="$interpreter"
    capture "$interpreter" "$TIER" --dry-run "$WT"
    expect_rc 0 "$rc"
    expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only; observing tests: none"
    expect_stdout "  src/app.ts"
    expect_stdout "would run: pnpm lint:js && pnpm typecheck && pnpm check:comment-density && pnpm check:ledgers && pnpm exec prettier --check --ignore-unknown -- src/app.ts"
    expect_not_out "verify:full"
    expect_not_out "unbound variable"
  done
  case_ctx=""
  end
fi

# The pragma case, and the reason the compiler stays in the leg list. `@ts-expect-error` is a
# comment: esbuild strips it, the two emits match, and the rung takes the change — which is
# exactly right, because the pragma changes no behaviour and exactly wrong if the tier then
# skipped tsc, the only gate that reads it. What tsc then says is tsc's business (see this
# file's header).
if begin_with_esbuild "a @ts-expect-error hidden in a comment does not defeat the proof, and typecheck still runs"; then
  must fixture pragma_in_comment
  write_in src/app.ts 'export const a = 1; // @ts-expect-error'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only"
  expect_stdout "pnpm typecheck"
  end
fi

# A .css comment is observable by stylelint and by nothing else in the composite, so the leg
# list is the assertion: stylelint present, eslint absent (it was given no file it handles).
if begin_with_esbuild "a comment-only .css edit is the source-prose tier, and stylelint is the leg that runs"; then
  must fixture comment_only_css
  write_in src/app.css '.a { color: red; }'
  seed_origin 'style: a stylesheet to comment on'
  write_in src/app.css '.a { color: red; } /* now with a note */'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only; observing tests: none"
  expect_stdout "would run: pnpm exec stylelint --max-warnings 0 -- src/app.css && pnpm typecheck"
  expect_not_stdout "eslint"
  expect_not_out "verify:full"
  end
fi

# A file with no emit to compare against is not a file with an unchanged emit. This is the
# state a comment-only branch reaches the moment it also adds a module.
if begin_with_esbuild "an untracked source file is the full tier"; then
  must fixture new_source
  write_in src/brand-new.ts 'export const b = 1;'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: full"
  expect_stdout "new since the merge-base, so there is no emit to compare against — src/brand-new.ts"
  expect_not_stdout "verify tier: source-prose"
  end
fi

# THE OBSERVING SET, arm (a): a test that reads files as data can see a comment without ever
# naming the file it lives in. Asserted as a delta in one repository rather than as two
# fixtures, because the claim is about the test CHANGING — a selection that was already
# correct before the change would pass a two-fixture version of this case.
if begin_with_esbuild "a test that gains a readFileSync joins the observing set, and vitest runs it from its package"; then
  must fixture observing_data
  write_in pkg/package.json '{ "name": "@fixture/pkg", "private": true }'
  write_in pkg/src/reader.test.ts "it('reads nothing', () => {});"
  seed_origin 'test: a test that reads nothing'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "observing tests: none"
  expect_not_stdout "vitest"

  must gitc "$WT" checkout --quiet -- src/app.ts
  write_in pkg/src/reader.test.ts "it('reads', () => readFileSync('somewhere'));"
  seed_origin 'test: the test now reads a file'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only; observing tests: pkg/src/reader.test.ts"
  expect_stdout "pnpm --filter ./pkg --fail-if-no-match exec vitest run src/reader.test.ts"
  end
fi

# Arm (b), and the reason it exists: a contract test that names the file it asserts about
# observes a comment in it without reading anything at run time.
if begin_with_esbuild "a test naming the changed file's basename joins the observing set"; then
  must fixture observing_basename
  write_in pkg/package.json '{ "name": "@fixture/pkg", "private": true }'
  write_in pkg/src/names.test.ts "it('knows app.ts', () => {});"
  seed_origin 'test: a test that names the module'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "observing tests: pkg/src/names.test.ts"
  expect_stdout "pnpm --filter ./pkg --fail-if-no-match exec vitest run src/names.test.ts"
  end
fi

# The Playwright lane is outside `verify` (testing.md rule 10), so a *.spec.* file is never
# selected to run however loudly it observes the change — a tier stricter than the composite
# it stands in for is a spurious red, and a spurious red is how a gate gets bypassed. This
# case is what goes red if the suffix filter is ever dropped as redundant.
if begin_with_esbuild "a browser spec that reads files is not selected, because the composite never runs one"; then
  must fixture observing_spec
  write_in pkg/package.json '{ "name": "@fixture/pkg", "private": true }'
  write_in pkg/e2e/browser.spec.ts "test('reads', () => readFileSync('app.ts'));"
  seed_origin 'test: a browser spec that reads a file'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only; observing tests: none"
  expect_not_stdout "vitest"
  expect_not_stdout "browser.spec.ts"
  end
fi

# Markdown rides along: the count is what was PROVEN, not what changed, and the gates that
# can observe a .md rejoin the list. Without this, a prose PR that also touches one comment
# would silently stop checking its own links.
if begin_with_esbuild "markdown alongside a comment-only source edit keeps the markdown gates"; then
  must fixture prose_and_source
  write_in docs/tier-fixture-guide.md '# Guide, revised'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 1 file(s) proven comment-only"
  expect_stdout "  docs/tier-fixture-guide.md"
  expect_stdout "  src/app.ts"
  expect_stdout "pnpm check:adr-index && pnpm check:ledgers && pnpm check:no-course-content && pnpm check:markdown-links"
  expect_stdout "pnpm exec prettier --check --ignore-unknown -- docs/tier-fixture-guide.md src/app.ts"
  end
fi

# ==========================================================================================
# 6. THE SOUNDNESS GUARD: the docs tier's claim, checked rather than assumed
# ==========================================================================================
# The docs tier rests on "no test can observe this markdown". These two cases are what turn
# that from an assumption into a checked fact — and they are the cases that go red if the
# guard is ever removed as an optimisation, because everything else about a markdown-only
# change set stays true.
begin "a test naming the changed markdown path forces the full tier, and the hit is printed"
must fixture guard_path
write_in src/copy.test.ts "const doc = 'docs/tier-fixture-guide.md';"
seed_origin 'test: read the guide'
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "a test file references a markdown path in this change set"
expect_stdout "guard: src/copy.test.ts:1:"
expect_not_stdout "verify tier: docs"
end

# The basename arm, and the reason it exists: a path assembled at run time holds no
# repo-relative path anywhere in the source, so a guard matching only full paths would
# certify this change set as unobservable while the test reads exactly the file that changed.
begin "a test naming only the changed file's basename forces the full tier"
must fixture guard_basename
write_in src/copy.spec.ts "const doc = join(root, 'docs', 'tier-fixture-guide.md');"
seed_origin 'test: join the guide path'
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "guard: src/copy.spec.ts:1:"
end

# The control on both: a test that mentions some OTHER markdown file must not hold the tier
# hostage. Without this, a guard that simply grepped for `\.md` anywhere in the test trees
# would pass every case above — and would pin this repository, whose harnesses build markdown
# fixtures by the dozen, on the full tier forever.
begin "a test naming an unrelated markdown file leaves the docs tier alone"
must fixture guard_unrelated
write_in src/copy.test.ts "const doc = 'docs/some-other-document.md';"
seed_origin 'test: read another document'
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_not_stdout "guard: "
end

# An empty census is a broken census, not a clean one — the rule the check:* gates apply to
# their own scans. A repository whose test files cannot be found has no evidence to offer
# about what its tests can see, so it does not get the tier that depends on that evidence.
begin "a change set that could be checked against no test file at all is the full tier"
must fixture guard_no_tests
must gitc "$WT" rm --quiet src/app.test.ts
must gitc "$WT" commit --quiet -m 'chore: drop the tests'
must gitc "$WT" push --quiet origin main
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "found no test files to check the change set against"
expect_not_stdout "verify tier: docs"
end

# ==========================================================================================
# 7. FAIL CLOSED: a change set the classifier cannot trust is a full run
# ==========================================================================================
# Both cases below would classify as markdown-only if the failure were swallowed — the
# working tree holds one edited .md and nothing else — so each one is precisely the state in
# which a silently-degraded classifier would skip the composite.
begin "a fetch that cannot reach the remote is the full tier, with the reason"
must fixture no_remote
write_in docs/tier-fixture-guide.md '# Guide, revised'
must gitc "$WT" remote set-url origin "$ROOT/does-not-exist.git"
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full — could not fetch origin main"
expect_not_stdout "verify tier: docs"
end

begin "a HEAD with no merge-base against origin/main is the full tier, with the reason"
must fixture orphan
must gitc "$WT" checkout --quiet --orphan lonely
must gitc "$WT" commit --quiet -m 'orphan'
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full — no merge-base between HEAD and origin/main"
expect_not_stdout "verify tier: docs"
end

# ==========================================================================================
# 8. the report itself
# ==========================================================================================
# A branch can carry a hundred files since its merge-base, and a hundred-line dump before
# every gate is noise nobody reads. The count is the load-bearing number; the list is a
# courtesy, and it is summarised past the cap.
begin "a change set past the list cap is summarised, not dumped"
must fixture capped
i=1
while [ "$i" -le 22 ]; do
  write_in "docs/tier-fixture-$i.md" "# Doc $i"
  i=$((i + 1))
done
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 22 file(s)"
expect_stdout "… and 2 more"
end

# ==========================================================================================
# 9. invocations the classifier cannot give a verdict on
# ==========================================================================================
# Exit 2, never a tier: an invocation this script cannot make sense of is not evidence that
# the change set is safe, and answering "full" would hide the typo behind a slow green run.
begin "a nonexistent root exits 2, and names no tier"
capture bash "$TIER" --dry-run "$TMP_ROOT/does-not-exist"
expect_rc 2 "$rc"
expect_stderr "not a directory"
expect_not_stdout "verify tier: "
end

begin "an unknown option exits 2"
capture bash "$TIER" --docs
expect_rc 2 "$rc"
expect_stderr "unknown option --docs"
expect_not_stdout "verify tier: "
end

begin "a second directory argument exits 2"
must fixture two_args
capture bash "$TIER" --dry-run "$WT" "$WT"
expect_rc 2 "$rc"
expect_stderr "expected at most one directory"
expect_not_stdout "verify tier: "
end

begin "--help exits 0 and runs nothing"
capture bash "$TIER" --help
expect_rc 0 "$rc"
expect_stdout "Usage: bash .claude/scripts/verify-tier.sh"
expect_not_stdout "verify tier: "
end

# ==========================================================================================
# 10. LEG ORDER: the builder walks verify:full's own list
# ==========================================================================================
# The rung 2 header once claimed verify:full's order and did not keep it (#292). The order is
# now LEG_ORDER, walked slot by slot, so the claim holds if LEG_ORDER is verify:full — which
# this case reads off the real package.json rather than trusting anybody's copy. It is also
# what goes red when a gate joins verify:full and nobody decides which cheap tiers run it.
begin "LEG_ORDER is verify:full's leg list, with lint expanded and verify:root dropped"
if [ -z "$TOOL_REPO" ] || ! command -v node >/dev/null 2>&1; then
  bad "no repository or no node to read package.json with"
else
  want=$(node -e '
const s = require(process.argv[1]).scripts;
const expand = (name) => {
  const v = s[name];
  if (!/^pnpm [a-z:-]+( && pnpm [a-z:-]+)*$/.test(v)) return [name];
  return v.split(" && ").map((leg) => leg.slice(5)).flatMap(expand);
};
console.log(expand("verify:full").filter((leg) => leg !== "verify:root").join(" "));
' "$TOOL_REPO/package.json")
  have=$(sed -n 's/^LEG_ORDER="\(.*\)"$/\1/p' "$TIER")
  if [ -z "$want" ] || [ -z "$have" ]; then
    bad "could not read one of the two lists (verify:full: '$want'; LEG_ORDER: '$have')"
  elif [ "$want" != "$have" ]; then
    bad "LEG_ORDER drifted from verify:full — verify:full: $want — LEG_ORDER: $have"
  fi
fi
end

# Every rung 2 leg at once, so the emitted ORDER is asserted and not just the membership: the
# old builder ran check:ledgers ahead of check:adr-index and the observing tests after every
# check:* leg, the opposite of verify:full.
if begin_with_esbuild "a rung 2 set holding every kind of path emits its legs in verify:full's order"; then
  must fixture leg_order
  write_in pkg/package.json '{ "name": "@fixture/pkg", "private": true }'
  write_in pkg/src/reader.test.ts "it('reads', () => readFileSync('x'));"
  write_in src/app.css '.a { color: red; }'
  seed_origin 'test: a reading test and a stylesheet'
  write_in docs/tier-fixture-guide.md '# Guide, revised'
  write_in src/app.ts 'export const a = 1; // now with a note'
  write_in src/app.css '.a { color: red; } /* now with a note */'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-prose — 2 file(s) proven comment-only; observing tests: pkg/src/reader.test.ts"
  expect_stdout "would run: pnpm lint:js && pnpm exec stylelint --max-warnings 0 -- src/app.css && pnpm typecheck && pnpm check:comment-density && pnpm --filter ./pkg --fail-if-no-match exec vitest run src/reader.test.ts && pnpm check:adr-index && pnpm check:ledgers && pnpm check:no-course-content && pnpm check:markdown-links && pnpm exec prettier --check --ignore-unknown -- docs/tier-fixture-guide.md src/app.css src/app.ts"
  end
fi

# ==========================================================================================
# 11. TYPES: an unchanged emit is not an unchanged program text (#129)
# ==========================================================================================
# #129's change deleted an interface and renamed a return type across two .ts files; esbuild
# erases both, so the emit proof admits it, and the tier used to call it source-prose — the
# name the trim-batch rule reads as "only prose moved". The leg the move needs is whole
# eslint, because strictTypeChecked's rules read types across files.
if begin_with_esbuild "an interface deleted and a return type changed across two .ts files is source-types"; then
  must fixture type_only
  write_in src/shapes.ts 'export interface Gone { a: number }
export interface Kept { b: number }'
  write_in src/app.ts 'export function f(): number { return 1; }'
  seed_origin 'feat: two typed modules'
  write_in src/shapes.ts 'export interface Kept { b: number }'
  write_in src/app.ts 'export function f(): unknown { return 1; }'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-types — 2 file(s) with an unchanged emit and moved types; observing tests: none"
  expect_stdout "would run: pnpm lint:js && pnpm typecheck && pnpm check:comment-density && pnpm check:ledgers && pnpm exec prettier --check --ignore-unknown -- src/app.ts src/shapes.ts"
  expect_not_stdout "source-prose"
  end
fi

if begin_with_esbuild "a type change in a .tsx file is source-types"; then
  must fixture type_tsx
  write_in src/view.tsx 'export const V = (p: { a: number }) => <b>{p.a}</b>;'
  seed_origin 'feat: a view'
  write_in src/view.tsx 'export const V = (p: { a: string }) => <b>{p.a}</b>;'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-types — 1 file(s) with an unchanged emit and moved types"
  end
fi

# One moved type among comment-only files names the whole set: the tier says what the
# least prose-like file did.
if begin_with_esbuild "a type change beside a comment-only change is still source-types, and both are counted"; then
  must fixture type_and_comment
  write_in src/shapes.ts 'export type T = number;'
  seed_origin 'feat: a type alias'
  write_in src/shapes.ts 'export type T = string;'
  write_in src/app.ts 'export const a = 1; // now with a note'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-types — 1 file(s) proven comment-only, 1 file(s) with an unchanged emit and moved types"
  end
fi

# The no-typescript fallback: a classifier copy outside any repository resolves tools from the
# fixture's own node_modules only, which holds esbuild and nothing else, so the comparison that
# could prove "comment-only" cannot run and the set takes the label that claims less.
if begin_with_esbuild "with no typescript reachable, a comment-only .ts edit is source-types"; then
  must fixture no_typescript
  must mkdir -p "$ROOT/tool" "$WT/node_modules/.bin"
  must cp "$TIER" "$ROOT/tool/verify-tier.sh"
  # A wrapper, not a symlink: pnpm's .bin shim resolves its package from its own directory.
  must printf '#!/bin/sh\nexec "%s" "$@"\n' "$TOOL_REPO/node_modules/.bin/esbuild" >"$WT/node_modules/.bin/esbuild"
  must chmod +x "$WT/node_modules/.bin/esbuild"
  write_in src/app.ts 'export const a = 1; // now with a note'
  capture env GIT_CEILING_DIRECTORIES="$ROOT" bash "$ROOT/tool/verify-tier.sh" --dry-run "$WT"
  expect_rc 0 "$rc"
  expect_stdout "verify tier: source-types — 1 file(s) with an unchanged emit and moved types"
  end
fi

# ==========================================================================================
# 12. LEDGERS (#183)
# ==========================================================================================
begin "a one-line ledger edit is the ledgers tier, and runs check:ledgers"
must fixture ledger_edit
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts'
seed_origin 'chore: a ledger'
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts
carrier: src/app.test.ts'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: ledgers — 1 ledger(s); observing tests: none"
expect_stdout "would run: pnpm check:ledgers && pnpm exec prettier --check --ignore-unknown -- .claude/ledgers/tier-fixture.ledger"
expect_not_out "verify:full"
end

# A test that names the ledger observes it, and the data-reading arm stays out: a ledger is
# read by path, and that test names it.
begin "a test naming a changed ledger runs, and a test that merely reads files does not"
must fixture ledger_named
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts'
write_in pkg/package.json '{ "name": "@fixture/pkg", "private": true }'
write_in pkg/src/names.test.ts "// asserts what tier-fixture.ledger lists"
write_in pkg/src/reader.test.ts "it('reads', () => readFileSync('x'));"
seed_origin 'test: a test that names the ledger'
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts
claim: revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: ledgers — 1 ledger(s); observing tests: pkg/src/names.test.ts"
expect_stdout "pnpm --filter ./pkg --fail-if-no-match exec vitest run src/names.test.ts"
expect_not_stdout "reader.test.ts"
end

# A deleted path is the one non-markdown change a link can break on.
begin "a deleted ledger adds check:markdown-links"
must fixture ledger_deleted
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts'
seed_origin 'chore: a ledger'
must gitc "$WT" rm --quiet .claude/ledgers/tier-fixture.ledger
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: ledgers — 1 ledger(s)"
expect_stdout "would run: pnpm check:ledgers && pnpm check:markdown-links"
end

# A ledger one directory down is not the shape check-ledgers.sh reads, so no class claims it.
begin "a .ledger file below .claude/ledgers' top level is the full tier"
must fixture ledger_nested
write_in .claude/ledgers/old/tier-fixture.ledger 'owner: src/app.ts'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "neither markdown nor a source type the emit proof handles — .claude/ledgers/old/tier-fixture.ledger"
end

# ==========================================================================================
# 13. SCRIPTS (#180)
# ==========================================================================================
# script_fixture -> a fixture whose base holds a package.json naming one gate script, the
# script, its harness, a lib another script sources, and a harness for that other script.
script_fixture() {
  must fixture "$1"
  write_in package.json '{ "scripts": { "check:module-names": "bash .claude/scripts/check-module-names.sh", "lint:sh": "bash .claude/scripts/lint-shell.sh", "test:scripts": "bash .claude/scripts/run-script-tests.sh" } }'
  write_in .claude/scripts/run-script-tests.sh 'echo runs every harness'
  write_in .claude/hooks/tier-hook.sh 'bash .claude/scripts/tier-tool.sh'
  write_in .claude/scripts/tier-hook.test.sh 'bash .claude/hooks/tier-hook.sh'
  write_in .claude/scripts/verify-tier.sh 'echo names tier-lib.sh and runs nothing'
  write_in .claude/scripts/verify-tier.test.sh 'bash .claude/scripts/verify-tier.sh'
  write_in .claude/scripts/check-module-names.sh 'echo names'
  write_in .claude/scripts/check-module-names.test.sh 'bash .claude/scripts/check-module-names.sh'
  write_in .claude/scripts/tier-lib.sh 'lib() { :; }'
  write_in .claude/scripts/tier-tool.sh '. .claude/scripts/tier-lib.sh'
  write_in .claude/scripts/tier-tool.test.sh 'bash .claude/scripts/tier-tool.sh'
  write_in .claude/scripts/tier-other.test.sh 'echo unrelated'
  seed_origin 'chore: scripts and harnesses'
}

begin "a comment in a gate script is the scripts tier: shellcheck, the gate, its harness"
script_fixture script_comment
write_in .claude/scripts/check-module-names.sh 'echo names # now with a note'
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$TIER" --dry-run "$WT"
  expect_rc 0 "$rc"
  expect_stdout "verify tier: scripts — 1 shell script(s); observing tests: .claude/scripts/check-module-names.test.sh"
  expect_stdout "would run: pnpm lint:sh && pnpm check:ledgers && pnpm check:module-names && bash .claude/scripts/check-module-names.test.sh && pnpm exec prettier --check --ignore-unknown -- .claude/scripts/check-module-names.sh"
  expect_not_stdout "tier-tool.test.sh"
  expect_not_out "verify:full"
  expect_not_out "unbound variable"
done
case_ctx=""
end

# THE CLOSURE: tier-tool.test.sh never names the lib, but it runs tier-tool.sh, which sources
# it, and tier-hook.test.sh runs a hook that runs tier-tool.sh — two hops, which one pass over
# the pool cannot reach, because the hook sorts before the script that names the lib. The
# fixture's verify-tier.sh names the lib too and runs nothing, so its harness stays out.
begin "a lib edit runs the harnesses of what sources it, transitively, and not an unrelated one"
script_fixture script_lib
write_in .claude/scripts/tier-lib.sh 'lib() { return 1; }'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: scripts — 1 shell script(s); observing tests: .claude/scripts/tier-hook.test.sh, .claude/scripts/tier-tool.test.sh"
expect_stdout "bash .claude/scripts/tier-hook.test.sh && bash .claude/scripts/tier-tool.test.sh"
expect_not_stdout "tier-other.test.sh"
expect_not_stdout "check-module-names.test.sh"
expect_not_stdout "verify-tier.test.sh"
end

# The runner's own leg is the slot its edit reaches, and it replaces the selected harnesses:
# test:scripts runs them all.
begin "an edit to the script a test:scripts leg runs makes that slot run whole"
script_fixture script_runner
write_in .claude/scripts/run-script-tests.sh 'echo runs every harness, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "would run: pnpm lint:sh && pnpm check:ledgers && pnpm test:scripts && pnpm exec prettier --check --ignore-unknown -- .claude/scripts/run-script-tests.sh"
end

begin "a shell script below .claude/scripts' top level is the full tier"
script_fixture script_nested
write_in .claude/scripts/lib/tier-nested.sh 'echo nested'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "neither markdown nor a source type the emit proof handles — .claude/scripts/lib/tier-nested.sh"
end

begin "a non-shell file under .claude/ledgers is not a ledger"
must fixture ledger_not
write_in .claude/ledgers/notes.txt 'notes'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "neither markdown nor a source type the emit proof handles — .claude/ledgers/notes.txt"
end

# The scripts class is shell only: a module beside the scripts takes the emit proof.
if begin_with_esbuild "a code change to a .mjs under .claude/scripts is the full tier"; then
  script_fixture script_mjs
  write_in .claude/scripts/tier-facts.mjs 'export const a = 1;'
  seed_origin 'chore: a module beside the scripts'
  write_in .claude/scripts/tier-facts.mjs 'export const a = 2;'
  run_tier
  expect_rc 0 "$rc"
  expect_stdout "verify tier: full"
  expect_stdout "the minified emit changed — .claude/scripts/tier-facts.mjs"
  end
fi

# A slot nobody taught the builder runs whole: a copy of the classifier with a gate appended
# to LEG_ORDER, held outside any repository like the no-esbuild case's copy.
begin "a LEG_ORDER slot the builder has no rule for runs whole"
must fixture unknown_slot
must mkdir -p "$ROOT/tool"
must sed 's/^LEG_ORDER="\(.*\)"$/LEG_ORDER="\1 check:tier-fixture-gate"/' "$TIER" >"$ROOT/tool/verify-tier.sh"
write_in .claude/ledgers/tier-fixture.ledger 'owner: src/app.ts'
capture env GIT_CEILING_DIRECTORIES="$ROOT" bash "$ROOT/tool/verify-tier.sh" --dry-run "$WT"
expect_rc 0 "$rc"
expect_stdout "would run: pnpm check:ledgers && pnpm exec prettier --check --ignore-unknown -- .claude/ledgers/tier-fixture.ledger && pnpm check:tier-fixture-gate"
end

# A script that lint:sh's own command names makes the slot run whole, which it does anyway;
# the gate script's slot is the one that shows the mapping.
begin "a changed harness runs itself even when it names nothing that changed"
script_fixture script_harness
write_in .claude/scripts/tier-other.test.sh 'echo unrelated, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: scripts — 1 shell script(s); observing tests: .claude/scripts/tier-other.test.sh"
expect_stdout "bash .claude/scripts/tier-other.test.sh"
end

begin "a change to the classifier itself is the full tier"
script_fixture script_classifier
write_in .claude/scripts/verify-tier.sh 'echo a different classifier'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "a change to the classifier is a change to which legs run, which only the full composite can vouch for — .claude/scripts/verify-tier.sh"
end

begin "a script change with no package.json to read the legs from is the full tier"
must fixture script_no_manifest
write_in .claude/scripts/tier-tool.sh 'echo tool'
seed_origin 'chore: a script'
write_in .claude/scripts/tier-tool.sh 'echo tool # now with a note'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "could not read package.json's scripts"
end

# Shell under .claude/hooks is not this class's: the class is .claude/scripts' top level.
begin "a hook edit is the full tier"
script_fixture script_hook
write_in .claude/hooks/tier-hook.sh 'echo hook'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_stdout "neither markdown nor a source type the emit proof handles — .claude/hooks/tier-hook.sh"
end

begin "a script and a ledger together are one scripts+ledgers tier"
script_fixture script_and_ledger
write_in .claude/ledgers/tier-fixture.ledger 'owner: .claude/scripts/tier-tool.sh'
write_in .claude/scripts/tier-tool.sh '. .claude/scripts/tier-lib.sh # now with a note'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: scripts+ledgers — 1 shell script(s), 1 ledger(s)"
end

# ==========================================================================================
# 14. NEW PACKAGES AND THE BANKED GREEN TREE (#12)
# ==========================================================================================
# A shim `pnpm` stands in for the composite: these cases are about what the classifier banks
# and narrows, and a real verify:full in a fixture would be a run of nothing.
shim_pnpm() { # shim_pnpm <exit code> [<file to write into $WT during the run>]
  must mkdir -p "$ROOT/shim"
  if [ -n "${2:-}" ]; then
    must printf '#!/bin/sh\nprintf moved >"%s"\nexit %s\n' "$WT/$2" "$1" >"$ROOT/shim/pnpm"
  else
    must printf '#!/bin/sh\nexit %s\n' "$1" >"$ROOT/shim/pnpm"
  fi
  must chmod +x "$ROOT/shim/pnpm"
}

run_tier_for_real() { # the production invocation, NOT a dry run, with the shim first on PATH
  capture env PATH="$ROOT/shim:$PATH" bash "$TIER" "$WT"
}

new_package_fixture() {
  must fixture "$1"
  write_in pkg-new/package.json '{ "name": "@fixture/new", "private": true }'
  write_in pkg-new/src/x.ts 'export const x = 1;'
  write_in pnpm-lock.yaml "importers: { pkg-new: { name: '@fixture/new' } }"
  write_in docs/tier-fixture-new.md 'A guide to @fixture/new.'
  commit_all 'feat: a new package'
}

NEW_PACKAGE_LEGS="pnpm exec eslint --no-warn-ignored --max-warnings 0 -- pkg-new && pnpm --filter ./pkg-new --fail-if-no-match run --if-present typecheck && pnpm check:comment-density && pnpm --filter ./pkg-new --fail-if-no-match run --if-present test && pnpm check:ledgers && pnpm check:module-names && pnpm check:no-course-content && pnpm exec prettier --check --ignore-unknown -- pkg-new/src/x.ts"

begin "a new package is the full tier first, because its manifest moved the dependency tree"
new_package_fixture new_package_first
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full — 4 file(s); new package pkg-new has its manifest in the change set"
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "narrowed"
end

begin "a green full run banks its tree, and the package's next edit narrows to its own legs"
new_package_fixture new_package_then
shim_pnpm 0
run_tier_for_real
expect_rc 0 "$rc"
expect_stdout "verify tier: banked tree "
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full — 4 file(s); new package pkg-new has its manifest in the change set"
expect_stdout "verify tier: narrowed to package since banked tree "
expect_stdout "1 file(s) in new package(s) pkg-new; observing tests: none"
expect_stdout "would run: $NEW_PACKAGE_LEGS"
end

begin "a red full run banks nothing, so the next run is full again"
new_package_fixture new_package_red
shim_pnpm 1
run_tier_for_real
expect_rc 1 "$rc"
expect_not_stdout "banked tree"
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "narrowed"
end

begin "a tree that moved during the green run is not banked"
new_package_fixture new_package_moved
shim_pnpm 0 docs/tier-fixture-moved.md
run_tier_for_real
expect_rc 0 "$rc"
expect_stdout "verify tier: not banked — the working tree changed during the run"
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "narrowed"
end

# The bank is evidence about one merge-base. Publishing the branch moves the merge-base, and
# the banked tree no longer describes "this branch over that base".
begin "a bank for another merge-base is ignored"
new_package_fixture new_package_rebased
shim_pnpm 0
run_tier_for_real
expect_stdout "verify tier: banked tree "
must gitc "$WT" push --quiet origin main
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: full"
expect_not_stdout "narrowed"
end

begin "unchanged since the bank is not a free pass"
new_package_fixture new_package_unchanged
shim_pnpm 0
run_tier_for_real
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: not narrowed — nothing changed since banked tree"
expect_stdout "would run: pnpm verify:full"
end

# Reach is the package's own only while nothing outside it uses the package.
begin "a new package named by a file outside it does not narrow"
new_package_fixture new_package_used
write_in app/src/use.ts "import { x } from '@fixture/new';"
commit_all 'feat: use the new package'
shim_pnpm 0
run_tier_for_real
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: not narrowed since banked tree "
expect_stdout "— 1 file(s); new package pkg-new is named outside itself by app/src/use.ts"
expect_stdout "would run: pnpm verify:full"
end

begin "a manifest edit after the bank does not narrow"
new_package_fixture new_package_manifest
shim_pnpm 0
run_tier_for_real
write_in pkg-new/package.json '{ "name": "@fixture/new", "private": true, "dependencies": { "x": "1" } }'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: not narrowed since banked tree "
expect_stdout "— 1 file(s); new package pkg-new has its manifest in the change set"
end

begin "a new package whose manifest has no name does not narrow"
new_package_fixture new_package_nameless
write_in pkg-new/package.json '{ "private": true }'
commit_all 'chore: drop the name'
shim_pnpm 0
run_tier_for_real
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_rc 0 "$rc"
expect_stdout "could not read new package pkg-new's name"
expect_stdout "would run: pnpm verify:full"
end

begin "a shell file inside a new package adds lint:sh to its legs"
new_package_fixture new_package_shell
shim_pnpm 0
run_tier_for_real
write_in pkg-new/run.sh 'echo run'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: narrowed to package since banked tree "
expect_stdout "pnpm lint:sh"
end

# A reading test in another package observes the new package's files and runs; one inside it
# is already in the package's own suite and is not run twice.
begin "under the package class, reading tests elsewhere run, and the package's own run once"
must fixture new_package_readers
write_in lib/package.json '{ "name": "@fixture/lib", "private": true }'
write_in lib/src/reader.test.ts "it('reads', () => readFileSync('x'));"
seed_origin 'test: a reading test in another package'
write_in pkg-new/package.json '{ "name": "@fixture/new", "private": true }'
write_in pkg-new/src/x.ts 'export const x = 1;'
write_in pkg-new/src/x.test.ts "it('reads', () => readFileSync('x'));"
commit_all 'feat: a new package with a reading test'
shim_pnpm 0
run_tier_for_real
write_in pkg-new/src/x.ts 'export const x = 2;'
run_tier
expect_rc 0 "$rc"
expect_stdout "observing tests: lib/src/reader.test.ts, pkg-new/src/x.test.ts"
expect_stdout "pnpm --filter ./lib --fail-if-no-match exec vitest run src/reader.test.ts && pnpm --filter ./pkg-new --fail-if-no-match run --if-present test"
expect_not_stdout "vitest run src/x.test.ts"
end

begin "a banked tree git does not hold is ignored"
must fixture forged_bank
write_in src/app.ts 'export const a = 2;'
mb=$(git -C "$WT" merge-base HEAD origin/main)
must printf 'tree %s\nbase %s\n' 0123456789abcdef0123456789abcdef01234567 "$mb" >"$WT/.git/verify-tier-green"
run_tier
expect_rc 0 "$rc"
expect_stdout "would run: pnpm verify:full"
expect_not_stdout "narrow"
end

begin "a green full run with no merge-base banks nothing"
must fixture bank_no_remote
write_in docs/tier-fixture-guide.md '# Guide, revised'
must gitc "$WT" remote set-url origin "$ROOT/does-not-exist.git"
shim_pnpm 0
run_tier_for_real
expect_rc 0 "$rc"
expect_stdout "verify tier: not banked — no merge-base to bank this green run against"
end

# Narrowing is for a diff that classified full. A diff that is already cheap keeps its own
# tier even when the delta since the bank would classify full.
begin "a cheap diff is not re-classified against the bank"
must fixture bank_cheap_diff
write_in src/app.ts 'export const a = 2;'
shim_pnpm 0
run_tier_for_real
expect_stdout "verify tier: banked tree "
must gitc "$WT" checkout --quiet -- src/app.ts
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: docs — 1 file(s)"
expect_stdout "would run: $DOCS_LEGS"
expect_not_stdout "narrow"
end

# Narrowing classifies the delta with every class, not only the package one: a markdown edit
# after the bank is the docs tier.
begin "a markdown edit after a banked full run narrows to docs"
new_package_fixture new_package_docs
shim_pnpm 0
run_tier_for_real
write_in docs/tier-fixture-guide.md '# Guide, revised'
run_tier
expect_rc 0 "$rc"
expect_stdout "verify tier: narrowed to docs since banked tree "
expect_stdout "would run: $DOCS_LEGS"
end

# ==========================================================================================

printf '\n%d skipped (each SKIP line above names why)\n' "$skipped"
finish
