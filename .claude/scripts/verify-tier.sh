#!/usr/bin/env bash
#
# The tier classifier behind `pnpm verify` (cumulo#476, cumulo#477, #292).
#
# `verify` used to be one composite, run whole before every commit, and most
# change sets cannot be observed by most of it. This script asks, path by path,
# which gates can see the change at all, and runs the union of the answers:
#
#   every changed path matches \.md$          ->  docs tier
#   every path is .md or in a class below     ->  the classes present, `+`-joined
#   anything else                             ->  `pnpm verify:full`
#
#   source-prose   source whose minified emit and comment-free reprint are unchanged
#   source-emit    source whose minified emit is unchanged, not proven comment-only
#   package        a file inside a workspace member new since the merge-base
#   scripts        a .claude/scripts/*.sh file other than this one
#   ledgers        a .claude/ledgers/*.ledger file
#
# The tier is DERIVED, never chosen. That distinction is the whole design:
# CLAUDE.md bans hand-picking legs because a human picking "the relevant ones"
# is how a gate stops running, and a flag like `--docs` would be exactly that
# ban with a nicer spelling. Nobody is asked what changed; git and esbuild are.
#
# FAIL CLOSED, everywhere. An empty change set, a git command that fails, a fetch
# that cannot reach the remote, a path no class admits, a proof that cannot be
# run — every one of them runs the full composite. A class is reached only by a
# positive answer to its own question, so the failure direction is always "ran
# too much", never "ran too little". Offline is therefore not a regression: it is
# today's behaviour.
#
# CI is deliberately NOT tiered: .github/workflows/ci.yml calls `verify:full`
# explicitly. The saving here is on the local iteration loop, where the composite
# is paid several times per PR; widening it to CI is a separate decision with its
# own evidence, and until then CI's coverage is unchanged by this script.
#
# ---------------------------------------------------------------------------
# RUNG 1 — docs (cumulo#476)
#
# For a markdown-only change set only these legs can observe the change:
# verify:root, check:adr-index, check:ledgers, check:no-course-content (a .md under
# data/ is course content), check:markdown-links, format:check.
# The rest are never given a .md file at all, or read manifests and TypeScript.
#
# THE SOUNDNESS GUARD, and where it differs from cumulo#476's wording. The rung rests
# on a claim — "no test can observe this markdown" — and a claim nobody checks is
# an assumption. cumulo#476 asked for a blanket grep: any \.md reference anywhere in
# the test trees forces full. That form is not implementable here, and the reason
# is worth stating rather than discovering again. check-adr-index.test.sh and
# check-markdown-links.test.sh build markdown FIXTURES by the dozen, so the
# blanket grep returns hundreds of hits on a clean tree and would pin every run
# on the full tier forever.
#
# So the guard is scoped to the change set, which is the sharper question in any
# case: could a test observe THESE files? Any hit is printed with file and line,
# and forces the full tier. The basename arm is what catches a path assembled at
# run time — join(root, 'docs', 'x.md') contains no repo-relative path but does
# contain the basename — and it costs false positives on prose that merely names
# a file ("testing.md rule 7"). Those cost a full run, the direction this script
# is allowed to be wrong in.
#
# ---------------------------------------------------------------------------
# RUNG 2 — source-prose and source-emit (cumulo#477, #292)
#
# A comment-only source edit changes no emitted code, and most of the composite
# reads emitted code. The proof is mechanical: esbuild minifies the baseline blob
# and the working file with the extension's loader, and the two outputs are
# compared byte for byte. Identical output means the edit changed no emitted
# behaviour.
#
# COMMENT-ONLY OR NOT. The emit proof is the safety proof, and it does not say
# what moved, so a second comparison names it: TypeScript's printer, with
# removeComments, reprints both versions of a .ts/.tsx/.js file, and identical
# output is comment-only (source-prose); anything else is source-emit. The name
# is load-bearing: docs/standards/prose.md § Trim batches reads `source-prose` as
# "this PR moved only prose", and #129's deleted interface was labelled that way.
# No node, no typescript under node_modules, or a .css file (which has no
# reprint here) is source-emit, the label that claims less.
#
# THE BASELINE IS THE MERGE-BASE, not HEAD, and this is load-bearing. The change
# set below spans merge-base...HEAD as well as the worktree, so a file whose code
# change was COMMITTED on this branch is byte-identical between HEAD and the
# worktree — a HEAD baseline would prove that file comment-only and skip the very
# tests that catch it. One baseline for the whole change set, and it is the one
# the change set is derived from (when narrowing, below, that is the banked tree).
#
# --legal-comments=none is mandatory, and not for tidiness: esbuild's default
# outside bundling is to preserve legal comments (/*! … */, //! …) in place, so a
# file carrying a licence header would never minify identically and the rung
# would be unreachable for it. Stripping them makes the proof cover every comment
# in the file. The residual, stated because the tier line does not say it: an
# edit to a licence header is proven comment-only here, which is right about
# behaviour and would be wrong for a licence audit. Nothing in `verify` performs
# one.
#
# IDENTIFIER MINIFICATION IS OFF (--minify-whitespace --minify-syntax, never
# --minify). esbuild names mangled bindings from a character-frequency histogram
# of the whole source text, comments included, so rewriting a docblock can
# permute which letter each binding gets and two behaviourally identical files
# emit differently — cumulo#480 caught exactly that on a comment-only batch. Whitespace
# and syntax minification depend on the code alone, which is the property the
# proof needs. A false positive here is safe (it runs the full composite) but is
# documented to the author as "you changed code by accident", so it must not fire
# on prose.
#
# esbuild is a root devDependency declared for this rung, models-pull.sh's pin read
# and check-stored-output-pin.sh's import graphs (#30, #20, #276; carriers in
# .claude/ledgers/esbuild-provenance.ledger), and is
# RESOLVED here, never installed —
# $ROOT's node_modules first, then the repository holding this script, which is
# the same directory in production and is what lets verify-tier.test.sh classify
# throwaway fixture repositories that have no node_modules of their own. No
# binary, or a binary that errors on a file, is a full run. typescript, the
# root devDependency `tsc` runs from, is resolved the same way.
#
# WHAT STILL RUNS UNDER THIS RUNG, because comments and types are observable:
#
#   * eslint, WHOLE (`pnpm lint:js`), whenever a lintable file is admitted. The
#     config is strictTypeChecked, whose rules read types across files: a moved
#     type can change a no-unsafe-* verdict in an unchanged importer, and an added
#     /** @deprecated */ changes no-deprecated in every caller (#292). eslint on
#     the changed files alone sees neither. Suppression comments are themselves
#     lint errors by CLAUDE.md's policy, which is the same-file half.
#   * stylelint on the changed .css — CSS comment rules are per file.
#   * typecheck — pragmas live in comments (@ts-expect-error, /// <reference>),
#     and the emit proof cannot see them or a type. This is the leg the rung
#     exists to keep.
#   * prettier --check on the changed files — comments are formatted like
#     anything else.
#   * check:comment-density — counts comment lines, which is what a change set
#     on this rung changes (cumulo#553).
#   * check:adr-index, check:no-course-content and check:markdown-links, when the
#     set also holds .md — the one type this rung admits without an emit proof.
#   * the observing tests, below, and the legs every class runs (further down).
#
# Skipped, provably unaffected: every other package's vitest; stylelint when no
# .css changed; the shell harnesses when none is selected; and the check:* gates
# that read code SHAPE — module-names reads filenames, node-types and
# supply-chain-policy read manifests, no-network-egress reads the installed
# dependency tree. None of them can change under an unchanged emit.
#
# THE OBSERVING TESTS, selected mechanically. A test can observe a comment in
# exactly two ways, and each gets an arm: it reads files as data (readFileSync,
# import.meta.glob, fs.*), or it names a changed file. Both arms are greps over
# the test census, so a test added next month is selected by what it does rather
# than by anybody remembering to list it. An empty selection runs no tests, which
# is the honest answer and not a silent one — the tier line prints the set. The
# data-reading arm is this rung's and the package class's alone: a script or a
# ledger a test reads is read by path, which the naming arm sees, and that is the
# residual rung 1's guard accepts for markdown.
#
# *.spec.* files are scanned but never selected to RUN. docs/standards/testing.md
# rule 10 splits the lanes by suffix — "*.test.ts colocated is vitest (rule 6),
# e2e/*.spec.ts is the browser lane" — and places that lane "deliberately outside
# `verify`". The composite this tier stands in for does not run a spec, so a tier
# that did would be STRICTER than the thing it replaces, and a spurious red is
# how a gate gets bypassed. They stay in the census for rung 1's guard, which
# forces the full tier rather than running anything.
#
# A selected *.test.sh runs as `bash <harness>` rather than through
# run-script-tests.sh, which discovers a DIRECTORY and has no file-level entry
# point. The exit convention that runner aggregates on is stated by `finish` in
# harness-lib.sh, which every harness ends on, so a directly-run harness reports
# the same verdict. A vitest selection runs per package under
# `--fail-if-no-match`: a filter that matches no workspace member exits 0
# having run nothing.
#
# WHERE THE RUNGS DISAGREE, deliberately. A markdown-only change set whose file a
# test names goes full (rung 1's guard); the same file alongside any other class
# runs that test instead of everything. Rung 1 is cumulo#476's and is left as it
# was: both answers are safe, and the cheaper one is not worth reopening a merged
# decision for.
#
# ---------------------------------------------------------------------------
# SCRIPTS AND LEDGERS (#292)
#
# `verify` observes a shell script under .claude/scripts three ways: shellcheck
# reads every one (`lint:sh`), a harness names it, and a `verify:full` leg's
# package.json command runs it. So the class runs `lint:sh`, every leg whose
# command names a member of the CLOSURE, and every test naming a member. The
# closure starts at the changed basenames and adds any file under .claude/scripts
# or .claude/hooks that names a member, until nothing more joins: a lib is
# observed by whatever observes the scripts sourcing it, and harness-lib.sh,
# which every harness names, selects them all. This script runs only
# workspace-lib.sh, so it never joins. A change to either of the two is a change
# to which legs run, and only the full composite can vouch for that.
#
# check-ledgers.sh is a ledger's only reader, so the ledger class runs
# check:ledgers and any test naming the ledger. The ledger's owner is not in the
# change set, so the owner's tests have nothing new to observe.
#
# EVERY CLASS RUNS check:ledgers, because a carrier can sit in any file;
# check:markdown-links when a changed path is gone, because a link can target
# any path; and prettier --check on the changed files still present.
#
# ---------------------------------------------------------------------------
# NEW PACKAGES AND THE BANKED GREEN TREE (#12, #292)
#
# A new package arrives with its manifest and a lockfile edit, which no class
# admits, so its first run is full — the manifest moves the dependency tree the
# egress and node-types gates read. What makes the next run cheaper
# is evidence about that one. When `pnpm verify:full` run by this script exits 0
# and the working tree hashes the same after the run as before, the tree is
# BANKED (`git rev-parse --git-path verify-tier-green`: per worktree, never
# committed) beside the merge-base it was measured from. A tree that moved during
# the run is not banked: the green belongs to neither state (#81). Only a full
# run banks, so no cheaper verdict is ever built on another cheaper one.
#
# NARROWING. When the branch's diff classifies full and a tree is banked for the
# current merge-base, the delta from the banked tree to the working tree is
# classified the same way, with the banked tree as the emit baseline, and when
# that answer is cheaper its legs run instead. The tier line still names the
# diff's classification, which docs/standards/prose.md § Trim batches reads; the
# narrowing gets its own line.
#
# The package class: a file whose nearest ancestor holding a package.json is a
# workspace member (workspace-lib.sh's census) absent at the merge-base, whose
# manifest is not in the change set, and which no file outside it names — by its
# `name`, its repo-relative directory, or `/<directory basename>/` for a relative
# import — bar pnpm-lock.yaml and markdown. Nothing on main can depend on a
# package main lacks, and that scan is the check that nothing on the branch
# does, so the package's reach is its own: eslint over its directory (type-aware
# rules see across its files), lint:sh (a shebang file needs no .sh), its own
# typecheck and test scripts, check:comment-density, check:module-names,
# check:no-course-content (a new package can carry a fixture file), and the
# observing tests elsewhere.
#
# ---------------------------------------------------------------------------
# LEG ORDER. LEG_ORDER is `verify:full` with `lint` expanded and `verify:root`
# dropped, since `verify` has already run it. The builder walks it slot by slot,
# so a red stops at the leg the composite would have stopped at, and
# verify-tier.test.sh's parity case fails when the two lists disagree. A slot
# the builder has no rule for runs whole.
#
# ---------------------------------------------------------------------------
# Usage: bash .claude/scripts/verify-tier.sh [--dry-run] [REPO_ROOT]
#          REPO_ROOT defaults to the repository holding this script; the argument
#          exists so the harness can point the classifier at throwaway fixtures.
#          --dry-run classifies and prints, and runs no gate.
# Exit:  the delegated tier's exit code (0 pass, non-zero a red gate), or 2 if
#        the invocation itself was wrong.
#
set -uo pipefail
# Homebrew's prefix is not on a non-interactive shell's default PATH on this
# machine (same reason worktree-lib.sh does it). Harmless on Linux, where the
# directory does not exist.
#
# Appended, not prepended: prepending outranks a shellcheck the caller put
# ahead of Homebrew on purpose, which is the escape hatch lint-shell.sh's
# version refusal points at — that file's comment on this same line carries
# the reasoning, and every step of this chain has to agree or the one that
# prepends decides. (cumulo#502)
export PATH="$PATH:/opt/homebrew/bin"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
TOOLROOT=$(git -C "$SCRIPTS" rev-parse --show-toplevel 2>/dev/null) || TOOLROOT=""

# How many of the classified paths are listed before the list is summarised. A
# branch can carry a hundred files since its merge-base and a hundred-line dump
# before every gate is noise; the tier and the count are the load-bearing parts.
LIST_CAP=20

# The data-reading arm of the observing-test selection: a test matching this can
# see a comment without naming the file the comment lives in.
DATA_READING='readFileSync|readFile\(|import\.meta\.glob|fs\.'

# `verify:full`'s legs in its own order (see LEG ORDER above).
LEG_ORDER="lint:js lint:css lint:sh lint:workflows typecheck check:comment-density test check:adr-index check:ledgers check:module-names check:no-course-content check:no-network-egress check:node-types check:supply-chain-policy check:markdown-links test:scripts format:check"

DOCS_LEGS="pnpm check:adr-index && pnpm check:ledgers && pnpm check:no-course-content && pnpm check:markdown-links && pnpm format:check"

dry_run=0
root_arg=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    -h | --help)
      cat <<'EOF'
Usage: bash .claude/scripts/verify-tier.sh [--dry-run] [REPO_ROOT]

  REPO_ROOT   repository to classify (default: the one holding this script)
  --dry-run   classify and print the tier, run no gate

Exit: the delegated tier's exit code, or 2 if the invocation was wrong.
EOF
      exit 0
      ;;
    -*)
      printf 'verify-tier: unknown option %s\n' "$1" >&2
      exit 2
      ;;
    *)
      if [ -n "$root_arg" ]; then
        printf 'verify-tier: expected at most one directory, got a second: %s\n' "$1" >&2
        exit 2
      fi
      root_arg="$1"
      ;;
  esac
  shift
done

if [ -n "$root_arg" ]; then
  if [ ! -d "$root_arg" ]; then
    printf 'verify-tier: not a directory: %s\n' "$root_arg" >&2
    exit 2
  fi
  ROOT=$(cd "$root_arg" && pwd -P) || exit 2
else
  # The script's own directory, not the caller's: `pnpm verify` runs from the
  # workspace root today, but a classifier that silently followed a stale shell
  # cwd into another checkout is the failure the `verify root:` line exists to
  # catch, and this one would pick the tier from the wrong tree's diff.
  ROOT=$(git -C "$SCRIPTS" rev-parse --show-toplevel) || exit 2
fi
# Every later command runs in the repository under classification, so a `cd`
# that failed cannot be mistaken for a grep that found nothing.
cd "$ROOT" || exit 2

TMP=$(mktemp -d "${TMPDIR:-/tmp}/verify-tier.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM

CHANGED="$TMP/changed"
TESTS="$TMP/tests"
PATTERNS="$TMP/patterns"
OBSERVING="$TMP/observing"

# core.quotePath=false keeps non-ASCII paths readable rather than \xNN-escaped.
# A path holding a quote or a newline is still quoted by git, and a quoted path
# matches no extension any class handles, so it runs the full composite —
# fail-closed, and the reason line shows the quoting.
git_at() {
  git -C "$ROOT" -c core.quotePath=false "$@"
}

reason=""
proof_reason=""
MB=""
BASE=""
BASE_LABEL="the merge-base"
ESBUILD=""
TYPESCRIPT=""
typescript_looked=0

# collect_change_set -> writes the change set to $CHANGED, one path per line, and
# the merge-base it is measured from to $MB. Returns 1 with $reason set if any
# part of the derivation could not be trusted.
#
# Three sources, because no single git command covers them: what is edited or
# staged against HEAD, what is untracked but not ignored, and what this branch
# has committed since it left origin/main. The fetch is what makes the third one
# honest — a stale refs/remotes/origin/main puts the merge-base too far back,
# which widens the change set, which can only ever move the tier towards full.
collect_change_set() {
  if ! git_at fetch --quiet origin main >/dev/null 2>&1; then
    reason="could not fetch origin main (offline, or no such remote)"
    return 1
  fi
  if ! MB=$(git_at merge-base HEAD refs/remotes/origin/main 2>/dev/null) || [ -z "$MB" ]; then
    MB=""
    reason="no merge-base between HEAD and origin/main"
    return 1
  fi
  if ! git_at diff --name-only HEAD >"$TMP/raw" 2>/dev/null; then
    reason="git diff --name-only HEAD failed"
    return 1
  fi
  if ! git_at ls-files --others --exclude-standard >>"$TMP/raw" 2>/dev/null; then
    reason="git ls-files --others failed"
    return 1
  fi
  if ! git_at diff --name-only "$MB...HEAD" >>"$TMP/raw" 2>/dev/null; then
    reason="git diff --name-only $MB...HEAD failed"
    return 1
  fi
  if ! LC_ALL=C sort -u "$TMP/raw" >"$TMP/sorted"; then
    reason="could not sort the change set"
    return 1
  fi
  # grep exits 1 when nothing survives, which here means an empty change set —
  # a legitimate state the caller reports on its own terms, not a failure. Hence
  # the explicit `return 0` rather than falling off the end on grep's status.
  grep -v '^$' "$TMP/sorted" >"$CHANGED"
  return 0
}

# census_tests -> writes to $TESTS every *.test.* / *.spec.* path git knows about
# that is present in the working tree. Returns 1 with $reason set otherwise.
#
# An empty census is a broken census, not a clean one — the rule the check:*
# gates apply to their own scans. A repository whose test files cannot be found
# has no evidence to offer about what its tests can see, so it gets no rung at
# all: rung 1 cannot certify the change unobservable, and the other classes
# cannot find the tests that observe it.
census_tests() {
  local f count=0
  if ! git_at ls-files >"$TMP/allfiles" 2>/dev/null ||
    ! git_at ls-files --others --exclude-standard >>"$TMP/allfiles" 2>/dev/null; then
    reason="could not enumerate the test files to check the change set against"
    return 1
  fi
  grep -E '(\.test\.|\.spec\.)' "$TMP/allfiles" | LC_ALL=C sort -u >"$TMP/tests-all"

  if [ ! -s "$TMP/tests-all" ]; then
    reason="found no test files to check the change set against — an empty scan is not a clean one"
    return 1
  fi

  # ls-files lists paths that are deleted in the working tree too; grep would
  # exit 2 on those and turn a clean scan into an error.
  : >"$TESTS"
  while IFS= read -r f; do
    [ -f "$ROOT/$f" ] || continue
    printf '%s\n' "$f" >>"$TESTS"
    count=$((count + 1))
  done <"$TMP/tests-all"
  if [ "$count" -eq 0 ]; then
    reason="every discovered test file is absent from the working tree"
    return 1
  fi
  return 0
}

# change_set_patterns -> writes to $PATTERNS the fixed strings a test file is
# searched for: every changed path, every changed basename, and every member of
# the script closure.
change_set_patterns() {
  local f
  : >"$PATTERNS"
  while IFS= read -r f; do
    printf '%s\n%s\n' "$f" "${f##*/}" >>"$PATTERNS"
  done <"$CHANGED"
  [ -f "$TMP/closure" ] && cat "$TMP/closure" >>"$PATTERNS"
  return 0
}

# guard_hits -> 0 the change set is unobservable by any test, 1 it may not be.
# Writes the offending file:line matches to $TMP/hits when it returns 1.
guard_hits() {
  local f files
  census_tests || return 1
  : >"$TMP/closure"
  change_set_patterns

  files=()
  while IFS= read -r f; do
    files+=("$f")
  done <"$TESTS"

  # -F: the patterns are paths, and a path's dots are not wildcards.
  grep -nF -f "$PATTERNS" -- "${files[@]}" >"$TMP/hits" 2>/dev/null
  case $? in
    0)
      reason="a test file references a markdown path in this change set"
      return 1
      ;;
    1)
      return 0
      ;;
    *)
      reason="the guard grep over the test files failed"
      return 1
      ;;
  esac
}

# loader_for <path> -> the esbuild loader for the path's extension, or 1 when the
# emit proof does not handle it.
loader_for() {
  case "$1" in
    *.ts) printf 'ts\n' ;;
    *.tsx) printf 'tsx\n' ;;
    *.js | *.mjs | *.cjs) printf 'js\n' ;;
    *.css) printf 'css\n' ;;
    *) return 1 ;;
  esac
}

# find_dev_tool <path under node_modules>... -> the first that exists under $ROOT
# or the repository holding this script, or 1.
find_dev_tool() {
  local d c
  for d in "$ROOT" "$TOOLROOT"; do
    [ -n "$d" ] || continue
    for c in "$@"; do
      if [ -e "$d/node_modules/$c" ]; then
        printf '%s\n' "$d/node_modules/$c"
        return 0
      fi
    done
  done
  return 1
}

# prove_comment_only <path> <loader> -> 0 when the path's minified emit is
# unchanged since $BASE, 1 with $proof_reason set otherwise. Leaves the baseline
# source in $TMP/base.src for reprint_unchanged.
prove_comment_only() {
  local path="$1" loader="$2"
  if ! git_at cat-file -e "$BASE:$path" 2>/dev/null; then
    proof_reason="new since $BASE_LABEL, so there is no emit to compare against — $path"
    return 1
  fi
  if [ ! -f "$ROOT/$path" ]; then
    proof_reason="gone from the working tree, which removes its emit entirely — $path"
    return 1
  fi
  if ! git_at show "$BASE:$path" >"$TMP/base.src" 2>/dev/null; then
    proof_reason="could not read the baseline blob — $path"
    return 1
  fi
  if ! "$ESBUILD" --minify-whitespace --minify-syntax "--loader=$loader" --legal-comments=none \
    <"$TMP/base.src" >"$TMP/base.min" 2>"$TMP/esbuild.err"; then
    proof_reason="esbuild could not minify the baseline version — $path"
    return 1
  fi
  if ! "$ESBUILD" --minify-whitespace --minify-syntax "--loader=$loader" --legal-comments=none \
    <"$ROOT/$path" >"$TMP/work.min" 2>"$TMP/esbuild.err"; then
    proof_reason="esbuild could not minify the working version — $path"
    return 1
  fi
  if ! cmp -s "$TMP/base.min" "$TMP/work.min"; then
    proof_reason="the minified emit changed — $path"
    return 1
  fi
  return 0
}

# reprint_unchanged <path> <loader> -> 0 when the comment-free reprint of the
# path matches its baseline's (see COMMENT-ONLY OR NOT above), 1 when it does not
# or no reprint could be made.
reprint_unchanged() {
  case "$2" in
    ts | tsx | js) ;;
    *) return 1 ;;
  esac
  if [ "$typescript_looked" = 0 ]; then
    typescript_looked=1
    TYPESCRIPT=$(find_dev_tool typescript/lib/typescript.js) || TYPESCRIPT=""
  fi
  [ -n "$TYPESCRIPT" ] || return 1
  node -e '
const ts = require(process.argv[1]);
const fs = require("fs");
const kind = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS }[process.argv[2]];
const printer = ts.createPrinter({ removeComments: true });
const reprint = (file) =>
  printer.printFile(
    ts.createSourceFile("f." + process.argv[2], fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, kind),
  );
process.exit(reprint(process.argv[3]) === reprint(process.argv[4]) ? 0 : 1);
' "$TYPESCRIPT" "$2" "$TMP/base.src" "$ROOT/$1" >/dev/null 2>&1
}

# owning_package_dir <repo-relative file> -> the nearest ancestor directory
# holding a package.json, which is the workspace member vitest must run from.
# Walked rather than read off pnpm-workspace.yaml.
owning_package_dir() {
  local d="${1%/*}"
  while [ -n "$d" ] && [ "$d" != "." ] && [ "$d" != "$1" ]; do
    if [ -f "$ROOT/$d/package.json" ]; then
      printf '%s\n' "$d"
      return 0
    fi
    case "$d" in
      */*) d="${d%/*}" ;;
      *) d="" ;;
    esac
  done
  return 1
}

workspace_looked=0
# workspace_member <dir> -> 0 when the dir is a member by workspace-lib.sh's
# census. An unreadable census makes nothing a member, so the path falls through
# to the emit proof.
workspace_member() {
  local m
  if [ "$workspace_looked" = 0 ]; then
    workspace_looked=1
    WORKSPACE_MEMBERS=()
    if [ -f "$SCRIPTS/workspace-lib.sh" ]; then
      # shellcheck source=./workspace-lib.sh
      . "$SCRIPTS/workspace-lib.sh"
      workspace_read verify-tier "$ROOT" 2>/dev/null || WORKSPACE_MEMBERS=()
    fi
  fi
  for m in ${WORKSPACE_MEMBERS[@]+"${WORKSPACE_MEMBERS[@]}"}; do
    [ "$m" = "$1" ] && return 0
  done
  return 1
}

# package_admits <new package dir> <path> -> 0 when the path is in the package
# class (see NEW PACKAGES above), 1 with $reason set otherwise.
package_admits() {
  local pkg="$1" f="$2" name
  if [ "$f" = "$pkg/package.json" ]; then
    reason="new package $pkg has its manifest in the change set, so its dependency tree moved since $BASE_LABEL — $f"
    return 1
  fi
  grep -qxF -- "$pkg" "$TMP/pkg-ok" && return 0
  if ! name=$(node -e 'process.stdout.write(String(require(process.argv[1]).name || ""))' \
    "$ROOT/$pkg/package.json" 2>/dev/null) || [ -z "$name" ]; then
    reason="could not read new package $pkg's name, so nothing can check what depends on it — $f"
    return 1
  fi
  git_at grep -lF --untracked -e "$name" -e "$pkg/" -e "/${pkg##*/}/" -- . ":(exclude)$pkg" \
    ':(exclude)pnpm-lock.yaml' ':(exclude)*.md' >"$TMP/pkg-hits" 2>/dev/null
  case $? in
    0)
      reason="new package $pkg is named outside itself by $(head -n 1 "$TMP/pkg-hits"), so its reach is not its own — $f"
      return 1
      ;;
    1)
      printf '%s\n' "$pkg" >>"$TMP/pkg-ok"
      return 0
      ;;
    *)
      reason="the dependents scan for new package $pkg failed — $f"
      return 1
      ;;
  esac
}

# script_closure -> writes to $TMP/closure the basenames observed through the
# changed scripts (see SCRIPTS AND LEDGERS above). Returns 1 with $reason set
# when the scripts and hooks could not be listed.
script_closure() {
  local f b grown
  : >"$TMP/closure"
  [ -s "$TMP/c-script" ] || return 0
  while IFS= read -r f; do
    printf '%s\n' "${f##*/}"
  done <"$TMP/c-script" | LC_ALL=C sort -u >"$TMP/closure"
  if ! git_at ls-files --cached --others --exclude-standard -- .claude/scripts .claude/hooks \
    >"$TMP/pool-raw" 2>/dev/null; then
    reason="could not list the scripts and hooks a changed script can be observed through"
    return 1
  fi
  grep -v -x -F .claude/scripts/verify-tier.sh "$TMP/pool-raw" >"$TMP/pool"
  grown=1
  while [ "$grown" = 1 ]; do
    grown=0
    while IFS= read -r f; do
      [ -f "$ROOT/$f" ] || continue
      b="${f##*/}"
      grep -qxF -- "$b" "$TMP/closure" && continue
      if grep -qF -f "$TMP/closure" -- "$ROOT/$f"; then
        printf '%s\n' "$b" >>"$TMP/closure"
        grown=1
      fi
    done <"$TMP/pool"
  done
  if ! node -e '
const scripts = require(process.argv[1]).scripts || {};
for (const [name, command] of Object.entries(scripts)) console.log(name + "\t" + String(command).replace(/[\t\n]/g, " "));
' "$ROOT/package.json" >"$TMP/script-map" 2>/dev/null; then
    reason="could not read package.json's scripts, so nothing can tell which legs run a changed script"
    return 1
  fi
  return 0
}

# classify_paths -> sorts every path in $CHANGED into $TMP/c-<class>. Returns 1
# with $reason set at the first path no class admits.
classify_paths() {
  local f pkg loader c
  for c in md src comment type pkg pkgdirs script ledger; do
    : >"$TMP/c-$c"
  done
  : >"$TMP/pkg-ok"
  : >"$TMP/closure"
  : >"$TMP/script-map"
  while IFS= read -r f; do
    case "$f" in
      *.md)
        printf '%s\n' "$f" >>"$TMP/c-md"
        continue
        ;;
      .claude/scripts/verify-tier.sh | .claude/scripts/workspace-lib.sh)
        reason="a change to the classifier is a change to which legs run, which only the full composite can vouch for — $f"
        return 1
        ;;
      .claude/scripts/*/* | .claude/ledgers/*/*) ;;
      .claude/scripts/*.sh)
        printf '%s\n' "$f" >>"$TMP/c-script"
        continue
        ;;
      .claude/ledgers/*.ledger)
        printf '%s\n' "$f" >>"$TMP/c-ledger"
        continue
        ;;
    esac
    if pkg=$(owning_package_dir "$f") && workspace_member "$pkg" &&
      ! git_at cat-file -e "$MB:$pkg/package.json" 2>/dev/null; then
      package_admits "$pkg" "$f" || return 1
      printf '%s\t%s\n' "$pkg" "$f" >>"$TMP/c-pkg"
      continue
    fi
    if ! loader=$(loader_for "$f"); then
      reason="neither markdown nor a source type the emit proof handles — $f"
      return 1
    fi
    if [ -z "$ESBUILD" ] && ! ESBUILD=$(find_dev_tool .bin/esbuild .pnpm/node_modules/.bin/esbuild); then
      ESBUILD=""
      reason="no esbuild binary under node_modules to prove an unchanged emit with"
      return 1
    fi
    if ! prove_comment_only "$f" "$loader"; then
      reason="$proof_reason"
      return 1
    fi
    printf '%s\n' "$f" >>"$TMP/c-src"
    if reprint_unchanged "$f" "$loader"; then
      printf '%s\n' "$f" >>"$TMP/c-comment"
    else
      printf '%s\n' "$f" >>"$TMP/c-type"
    fi
  done <"$CHANGED"
  cut -f1 "$TMP/c-pkg" | LC_ALL=C sort -u >"$TMP/c-pkgdirs"
  script_closure
}

# select_observing_tests -> writes to $OBSERVING every runnable test file that can
# observe this change set. Returns 1 with $reason set when the selection could not
# be made, which is a full run like any other unanswerable question.
select_observing_tests() {
  local f files grc
  census_tests || return 1
  change_set_patterns
  : >"$OBSERVING"
  : >"$TMP/observing-raw"

  grep -v -E '\.spec\.' "$TESTS" >"$TMP/runnable"
  # A changed test runs whether or not it names itself: a pragma such as
  # `// @vitest-environment` is a comment both proofs pass.
  grep -xF -f "$CHANGED" "$TMP/runnable" >>"$TMP/observing-raw"
  files=()
  while IFS= read -r f; do
    files+=("$f")
  done <"$TMP/runnable"

  if [ "${#files[@]}" -gt 0 ]; then
    if [ -s "$TMP/c-src" ] || [ -s "$TMP/c-pkg" ]; then
      grep -lE "$DATA_READING" -- "${files[@]}" >>"$TMP/observing-raw" 2>/dev/null
      grc=$?
      if [ "$grc" -gt 1 ]; then
        reason="the data-reading scan over the test files failed"
        return 1
      fi
    fi
    # -F: the patterns are paths, and a path's dots are not wildcards.
    grep -lF -f "$PATTERNS" -- "${files[@]}" >>"$TMP/observing-raw" 2>/dev/null
    grc=$?
    if [ "$grc" -gt 1 ]; then
      reason="the basename scan over the test files failed"
      return 1
    fi
  fi

  if ! LC_ALL=C sort -u "$TMP/observing-raw" >"$OBSERVING"; then
    reason="could not sort the observing-test selection"
    return 1
  fi
  return 0
}

legs=""

append_leg() {
  legs="${legs:+$legs && }$1"
}

# append_file_leg <command prefix> <file holding the paths> -> one leg naming
# every path in the list, shell-quoted, or no leg at all when the list is empty.
append_file_leg() {
  local prefix="$1" list="$2" f leg
  [ -s "$list" ] || return 0
  leg="$prefix"
  while IFS= read -r f; do
    leg="$leg $(printf '%q' "$f")"
  done <"$list"
  append_leg "$leg"
}

# append_package_legs <script> -> one `pnpm --filter` leg per new package,
# running that package's own script.
append_package_legs() {
  local pkg
  while IFS= read -r pkg; do
    append_leg "pnpm --filter $(printf '%q' "./$pkg") --fail-if-no-match run --if-present $1"
  done <"$TMP/c-pkgdirs"
}

# slot_runs_closure <slot> -> 0 when the slot's package.json command names a
# member of the script closure, so the slot must run whole.
slot_runs_closure() {
  local command b
  command=$(awk -F '\t' -v s="$1" '$1 == s { print $2; exit }' "$TMP/script-map")
  [ -n "$command" ] || return 1
  while IFS= read -r b; do
    case "$command" in
      *"$b"*) return 0 ;;
    esac
  done <"$TMP/closure"
  return 1
}

# build_legs -> fills $legs by walking LEG_ORDER (see LEG ORDER above), and $name
# with the tier's name.
build_legs() {
  local f pkg prev args slot has_md=0 has_src=0 has_pkg=0 has_script=0 has_deleted=0

  : >"$TMP/present"
  : >"$TMP/css"
  while IFS= read -r f; do
    if [ ! -f "$ROOT/$f" ]; then
      has_deleted=1
      continue
    fi
    printf '%s\n' "$f" >>"$TMP/present"
    case "$f" in
      *.css) printf '%s\n' "$f" >>"$TMP/css" ;;
    esac
  done <"$CHANGED"
  grep -v '\.css$' "$TMP/c-src" >"$TMP/lintable"
  [ -s "$TMP/c-md" ] && has_md=1
  [ -s "$TMP/c-src" ] && has_src=1
  [ -s "$TMP/c-pkg" ] && has_pkg=1
  [ -s "$TMP/c-script" ] && has_script=1

  : >"$TMP/vitest-jobs"
  : >"$TMP/harness-jobs"
  while IFS= read -r f; do
    case "$f" in
      *.test.sh)
        printf '%s\n' "$f" >>"$TMP/harness-jobs"
        continue
        ;;
    esac
    if ! pkg=$(owning_package_dir "$f"); then
      reason="an observing test sits in no workspace package, so nothing knows how to run it — $f"
      return 1
    fi
    # A new package's whole suite runs, which holds this file.
    grep -qxF -- "$pkg" "$TMP/c-pkgdirs" && continue
    printf '%s\t%s\n' "$pkg" "$f" >>"$TMP/vitest-jobs"
  done <"$OBSERVING"
  if ! LC_ALL=C sort -o "$TMP/vitest-jobs" "$TMP/vitest-jobs"; then
    reason="could not group the observing tests by package"
    return 1
  fi

  legs=""
  for slot in $LEG_ORDER; do
    if slot_runs_closure "$slot"; then
      append_leg "pnpm $slot"
      continue
    fi
    case "$slot" in
      lint:js)
        if [ -s "$TMP/lintable" ]; then
          append_leg "pnpm lint:js"
        else
          while IFS= read -r pkg; do
            append_leg "pnpm exec eslint --no-warn-ignored --max-warnings 0 -- $(printf '%q' "$pkg")"
          done <"$TMP/c-pkgdirs"
        fi
        ;;
      lint:css)
        append_file_leg "pnpm exec stylelint --max-warnings 0 --" "$TMP/css"
        ;;
      lint:sh)
        if [ "$has_script" = 1 ] || [ "$has_pkg" = 1 ]; then
          append_leg "pnpm lint:sh"
        fi
        ;;
      typecheck)
        if [ "$has_src" = 1 ]; then
          append_leg "pnpm typecheck"
        else
          append_package_legs typecheck
        fi
        ;;
      check:comment-density)
        if [ "$has_src" = 1 ] || [ "$has_pkg" = 1 ]; then
          append_leg "pnpm $slot"
        fi
        ;;
      test)
        # One vitest per package, its files named RELATIVE to that package:
        # vitest matches a positional against paths from its own working
        # directory, so a repo-relative path matches nothing and exits 1 with
        # "No test files found".
        prev=""
        args=""
        while IFS=$'\t' read -r pkg f; do
          if [ "$pkg" != "$prev" ]; then
            [ -z "$prev" ] ||
              append_leg "pnpm --filter $(printf '%q' "./$prev") --fail-if-no-match exec vitest run$args"
            prev="$pkg"
            args=""
          fi
          args="$args $(printf '%q' "${f#"$pkg"/}")"
        done <"$TMP/vitest-jobs"
        [ -z "$prev" ] ||
          append_leg "pnpm --filter $(printf '%q' "./$prev") --fail-if-no-match exec vitest run$args"
        append_package_legs test
        ;;
      check:adr-index)
        if [ "$has_md" = 1 ]; then
          append_leg "pnpm $slot"
        fi
        ;;
      check:ledgers)
        append_leg "pnpm $slot"
        ;;
      check:module-names)
        if [ "$has_pkg" = 1 ]; then
          append_leg "pnpm $slot"
        fi
        ;;
      check:no-course-content)
        if [ "$has_md" = 1 ] || [ "$has_pkg" = 1 ]; then
          append_leg "pnpm $slot"
        fi
        ;;
      check:markdown-links)
        if [ "$has_md" = 1 ] || [ "$has_deleted" = 1 ]; then
          append_leg "pnpm $slot"
        fi
        ;;
      test:scripts)
        while IFS= read -r f; do
          append_leg "bash $(printf '%q' "$f")"
        done <"$TMP/harness-jobs"
        ;;
      format:check)
        # --ignore-unknown: the same contract as the lint-staged `*` entry — a
        # path prettier has no parser for is skipped, not failed.
        append_file_leg "pnpm exec prettier --check --ignore-unknown --" "$TMP/present"
        ;;
      # Run only through the closure above: they read manifests, the installed
      # tree or workflow files, which no admitted class changes.
      lint:workflows | check:no-network-egress | check:node-types | check:supply-chain-policy) ;;
      *)
        append_leg "pnpm $slot"
        ;;
    esac
  done

  name=""
  if [ -s "$TMP/c-type" ]; then
    name="source-emit"
  elif [ -s "$TMP/c-comment" ]; then
    name="source-prose"
  fi
  [ "$has_pkg" = 1 ] && name="${name:+$name+}package"
  [ "$has_script" = 1 ] && name="${name:+$name+}scripts"
  [ -s "$TMP/c-ledger" ] && name="${name:+$name+}ledgers"
  return 0
}

# class_summary -> the per-class counts and the observing set, for the tier line.
class_summary() {
  local line="" n f total shown=0 observed=""
  n=$(grep -c '' <"$TMP/c-comment")
  [ "$n" -eq 0 ] || line="${line:+$line, }$n file(s) proven comment-only"
  n=$(grep -c '' <"$TMP/c-type")
  [ "$n" -eq 0 ] || line="${line:+$line, }$n file(s) with an unchanged emit, not proven comment-only"
  n=$(grep -c '' <"$TMP/c-pkg")
  [ "$n" -eq 0 ] || line="${line:+$line, }$n file(s) in new package(s) $(paste -s -d ' ' "$TMP/c-pkgdirs")"
  n=$(grep -c '' <"$TMP/c-script")
  [ "$n" -eq 0 ] || line="${line:+$line, }$n shell script(s)"
  n=$(grep -c '' <"$TMP/c-ledger")
  [ "$n" -eq 0 ] || line="${line:+$line, }$n ledger(s)"

  total=$(grep -c '' <"$OBSERVING")
  if [ "$total" -eq 0 ]; then
    observed="none"
  else
    while IFS= read -r f; do
      if [ "$shown" -ge "$LIST_CAP" ]; then
        observed="$observed, … and $((total - LIST_CAP)) more"
        break
      fi
      observed="${observed:+$observed, }$f"
      shown=$((shown + 1))
    done <"$OBSERVING"
  fi
  printf '%s; observing tests: %s' "$line" "$observed"
}

print_list() {
  local shown=0 f
  while IFS= read -r f; do
    if [ "$shown" -ge "$LIST_CAP" ]; then
      printf '  … and %d more\n' "$((changed_count - LIST_CAP))"
      break
    fi
    printf '  %s\n' "$f"
    shown=$((shown + 1))
  done <"$CHANGED"
}

# classify_tier -> sets $tier, $legs and $reason for $CHANGED measured from $BASE.
classify_tier() {
  tier=full
  legs=""
  : >"$TMP/hits"
  if [ -z "$(grep -v -E '\.md$' "$CHANGED" | head -n 1)" ]; then
    if guard_hits; then
      tier=docs
      reason="every path is markdown, and no test references one of them"
      # The legs that can observe markdown at all; verify:root is not among
      # them because `verify` has already run it before reaching this script.
      legs="$DOCS_LEGS"
    fi
  elif classify_paths && select_observing_tests && build_legs; then
    tier="$name"
  fi
}

# describe -> the text after the tier name on a tier line.
describe() {
  case "$tier" in
    docs) printf '%d file(s); %s' "$changed_count" "$reason" ;;
    full) printf '%d file(s); %s' "$changed_count" "$reason" ;;
    *) class_summary ;;
  esac
}

# current_tree -> the tree object of the working tree as `git add -A` sees it,
# over the real index's entries. Seeded with read-tree, so it holds every staged
# path — `git add -f` of an ignored file included, which an empty index would
# drop and check:no-course-content exists for — and no stat data, so every file
# is hashed from its content: a copy of the real index carries its stat cache
# under a newer mtime, which defeats git's racy-entry check.
current_tree() {
  local staged
  rm -f "$TMP/tree-index"
  staged=$(git_at write-tree 2>/dev/null) || return 1
  GIT_INDEX_FILE="$TMP/tree-index" git_at read-tree "$staged" >/dev/null 2>&1 || return 1
  GIT_INDEX_FILE="$TMP/tree-index" git_at add -A >/dev/null 2>&1 || return 1
  GIT_INDEX_FILE="$TMP/tree-index" git_at write-tree 2>/dev/null
}

# bank_path -> where this worktree's banked green tree lives.
bank_path() {
  git_at rev-parse --git-path verify-tier-green 2>/dev/null
}

# banked_tree -> the tree banked for the current merge-base, or 1.
banked_tree() {
  local f t b
  f=$(bank_path) || return 1
  [ -f "$f" ] || return 1
  t=$(sed -n 's/^tree \([0-9a-f]\{40,\}\)$/\1/p' "$f")
  b=$(sed -n 's/^base \([0-9a-f]\{40,\}\)$/\1/p' "$f")
  [ -n "$t" ] && [ -n "$MB" ] && [ "$b" = "$MB" ] || return 1
  [ "$(git_at cat-file -t "$t" 2>/dev/null)" = tree ] || return 1
  printf '%s\n' "$t"
}

# narrow <banked tree> -> reclassifies the delta since the banked tree (see
# NARROWING above), leaving $tier full when that answer is no cheaper.
narrow() {
  local green="$1" cur short
  short="${green:0:12}"
  if ! cur=$(current_tree); then
    printf 'verify tier: not narrowed — could not hash the working tree to compare with banked tree %s\n' "$short"
    return 0
  fi
  if ! git_at diff --name-only "$green" "$cur" >"$TMP/raw" 2>/dev/null; then
    printf 'verify tier: not narrowed — git could not diff banked tree %s against the working tree\n' "$short"
    return 0
  fi
  LC_ALL=C sort -u "$TMP/raw" | grep -v '^$' >"$CHANGED"
  changed_count=$(grep -c '' <"$CHANGED")
  if [ "$changed_count" -eq 0 ]; then
    printf 'verify tier: not narrowed — nothing changed since banked tree %s, and an unchanged tree is not a free pass\n' "$short"
    return 0
  fi
  BASE="$green"
  BASE_LABEL="banked tree $short"
  reason=""
  classify_tier
  if [ "$tier" = full ]; then
    printf 'verify tier: not narrowed since banked tree %s — %s\n' "$short" "$(describe)"
    return 0
  fi
  printf 'verify tier: narrowed to %s since banked tree %s — %s\n' "$tier" "$short" "$(describe)"
  print_list
}

# run_full -> runs the composite and banks the tree it ran on when the run was
# green and the tree held still (see NEW PACKAGES above). Exits with the run's rc.
run_full() {
  local before="" after rc bank
  [ -z "$MB" ] || before=$(current_tree) || before=""
  eval "$legs"
  rc=$?
  [ "$rc" -eq 0 ] || exit "$rc"
  if [ -z "$MB" ]; then
    printf 'verify tier: not banked — no merge-base to bank this green run against\n'
    exit 0
  fi
  if [ -z "$before" ] || ! after=$(current_tree); then
    printf 'verify tier: not banked — could not hash the working tree\n'
    exit 0
  fi
  if [ "$before" != "$after" ]; then
    printf 'verify tier: not banked — the working tree changed during the run, so this green belongs to neither state\n'
    exit 0
  fi
  if ! bank=$(bank_path) || ! printf 'tree %s\nbase %s\n' "$after" "$MB" >"$bank.tmp" ||
    ! mv "$bank.tmp" "$bank"; then
    printf 'verify tier: not banked — could not write the bank file\n'
    exit 0
  fi
  printf 'verify tier: banked tree %s as the last green full run\n' "${after:0:12}"
  exit 0
}

tier=full
changed_count=0

if collect_change_set; then
  BASE="$MB"
  changed_count=$(grep -c '' <"$CHANGED")
  if [ "$changed_count" -eq 0 ]; then
    reason="the change set is empty"
  else
    classify_tier
  fi
fi

if [ "$tier" = full ] && [ "$changed_count" -eq 0 ]; then
  printf 'verify tier: full — %s\n' "$reason"
else
  printf 'verify tier: %s — %s\n' "$tier" "$(describe)"
  print_list
fi
if [ "$tier" = full ] && [ -s "$TMP/hits" ]; then
  while IFS= read -r hit; do
    printf '  guard: %s\n' "$hit"
  done <"$TMP/hits"
fi

# changed_count is non-zero only after a change set that was collected whole.
if [ "$tier" = full ] && [ "$changed_count" -gt 0 ] && green=$(banked_tree); then
  narrow "$green"
fi

if [ "$tier" = full ]; then
  # The full tier delegates to the unconditional composite rather than
  # restating its legs: package.json is the one place that list lives (the same
  # reason the CI step calls the composite instead of enumerating gates), and a
  # second copy here would be the drift cumulo#47 was filed for.
  #
  # The `verify root:` line is therefore printed twice on this tier — once by
  # `verify`, once by the composite it delegates to. They are the same line
  # about the same tree; the alternative is a `verify:full` that no longer
  # states which tree it ran in, which the evidence ritual depends on.
  legs="pnpm verify:full"
fi

# One string, printed by --dry-run and executed otherwise. Not two copies of the
# list: every harness case asserts what --dry-run PRINTS, and a separate copy for
# the executing path would make those assertions about a string nothing runs.
if [ "$dry_run" = "1" ]; then
  printf 'verify tier: dry run — would run: %s\n' "$legs"
  exit 0
fi

if [ "$tier" = full ]; then
  run_full
fi
eval "$legs"
