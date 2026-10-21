#!/usr/bin/env bash
# Bundle gate for apps/web: the production entry chunk, dist/assets/index-*.js, stays
# under ENTRY_BUDGET_BYTES. Ported from cumulo's check-web-bundle.sh without its token-
# gallery arm, since cram.ai has no gallery (#19).
#
# The budget is a statement about that one file. Weight that lands beside it (a second
# module script in index.html) or never reaches dist/ passes untouched. The script never
# builds: the CI `web-build` job builds and then calls it, and its only interface is a
# repo root, so the harness can point it at fixtures.
#
# Usage: bash .claude/scripts/check-web-bundle.sh [--print-budget] [REPO_ROOT]
#        --print-budget prints ENTRY_BUDGET_BYTES and exits 0, so the harness sizes its
#        fixtures without restating the constant.
# Exit:  0 under budget, 1 over it, 2 no verdict (no build, a stale build, a bad invocation).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2

# Derivation: 326,304 bytes measured on 2026-10-21 on branch 16-web-ask, in the commit that
# last changed this line (`git log -L` on it finds that commit), via
#     pnpm --filter @cram/web build && wc -c < apps/web/dist/assets/index-*.js
# rounded up to give ~15% headroom (326,304 x 1.15 = 375,250 -> 376,000). A PR that
# deliberately grows the entry re-measures and resets this constant and its derivation in
# the same PR; an accidental breach is a dependency to find, not a number to raise. This is
# the one enforced copy: .github/workflows/ci.yml calls this script and restates nothing.
ENTRY_BUDGET_BYTES=376000

print_budget=0
root_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --print-budget) print_budget=1 ;;
    -*)
      printf 'check-web-bundle: unknown option %s\n' "$1" >&2
      exit 2
      ;;
    *)
      if [ -n "$root_arg" ]; then
        printf 'check-web-bundle: expected at most one REPO_ROOT, got a second: %s\n' "$1" >&2
        exit 2
      fi
      root_arg="$1"
      ;;
  esac
  shift
done

if [ "$print_budget" = "1" ]; then
  printf '%s\n' "$ENTRY_BUDGET_BYTES"
  exit 0
fi

ROOT=${root_arg:-"$SCRIPT_DIR/../.."}
if [ ! -d "$ROOT" ]; then
  printf 'check-web-bundle: not a directory: %s\n' "$ROOT" >&2
  exit 2
fi
ROOT=$(cd "$ROOT" && pwd -P) || exit 2

WEB_DIR=apps/web
ASSETS_DIR="$ROOT/$WEB_DIR/dist/assets"

no_build() {
  printf 'check-web-bundle: no build to check at %s/dist/assets — run "pnpm --filter @cram/web build" first\n' \
    "$WEB_DIR" >&2
  exit 2
}

file_bytes() { # file_bytes <path>
  wc -c <"$1" | tr -d '[:space:]'
}

[ -d "$ASSETS_DIR" ] || no_build

# A dist never cleaned holds one entry per build, and measuring whichever sorts first is a
# verdict about a file nobody ships.
entries=()
for candidate in "$ASSETS_DIR"/index-*.js; do
  [ -f "$candidate" ] || continue
  entries+=("$candidate")
done
[ ${#entries[@]} -ne 0 ] || no_build
if [ ${#entries[@]} -gt 1 ]; then
  printf '\ncheck-web-bundle: %d index-*.js files in %s/dist/assets — stale artefacts\n' \
    "${#entries[@]}" "$WEB_DIR" >&2
  for stale in "${entries[@]}"; do
    printf '  %s\n' "${stale#"$ROOT/"}" >&2
  done
  printf '\nRun "rm -rf apps/web/dist" and rebuild.\n' >&2
  exit 2
fi
entry=${entries[0]}

entry_bytes=$(file_bytes "$entry") || exit 2
if [ "$entry_bytes" -gt "$ENTRY_BUDGET_BYTES" ]; then
  printf '\ncheck-web-bundle: entry chunk over budget\n' >&2
  printf '  file    %s\n' "${entry#"$ROOT/"}" >&2
  printf '  actual  %s bytes\n' "$entry_bytes" >&2
  printf '  budget  %s bytes\n' "$ENTRY_BUDGET_BYTES" >&2
  printf '  over by %s bytes\n' "$((entry_bytes - ENTRY_BUDGET_BYTES))" >&2
  printf '\nIf this growth is deliberate, re-measure and reset ENTRY_BUDGET_BYTES to\n' >&2
  printf 'new-measured + ~15%% in this same PR, with the new derivation in its comment.\n' >&2
  printf 'If it is not, find the dependency that crept into the entry chunk.\n' >&2
  exit 1
fi

printf 'check-web-bundle: OK — entry %s bytes of %s budget (%s%% headroom): %s\n' \
  "$entry_bytes" "$ENTRY_BUDGET_BYTES" \
  "$(((ENTRY_BUDGET_BYTES - entry_bytes) * 100 / ENTRY_BUDGET_BYTES))" \
  "${entry#"$ROOT/"}"
printf '\n%s/dist/assets by size:\n' "$WEB_DIR"
for asset in "$ASSETS_DIR"/*; do
  [ -f "$asset" ] || continue
  printf '%12s  %s\n' "$(file_bytes "$asset")" "${asset#"$ROOT/"}"
done | sort -rn
