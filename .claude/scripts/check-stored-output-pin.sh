#!/usr/bin/env bash
# Stored-output pin gate: a branch that moves `PIN.digest` in packages/ingest/src/stored-output-pin.test.ts
# without raising SCHEMA_VERSION in packages/index/src/schema.ts may only have changed the pin's corpus (#276).
# The pin test is stateless, so it cannot tell that re-record from a digest edited in place over an ingest change;
# this gate reads what the branch changed since it left origin/main.
#
# Measured from `git merge-base HEAD refs/remotes/origin/main` to the working tree:
#
#   PIN.digest unchanged, or SCHEMA_VERSION rose           ->  0
#   a changed path is in ingest's production graph         ->  1
#   no changed path is in the corpus graph                 ->  1
#   otherwise (a corpus-only re-record)                    ->  0
#
# The production graph is esbuild's metafile inputs for packages/ingest/src/index.ts, plus
# packages/ingest/package.json, which pins the parsers; the corpus graph is the inputs for
# packages/ingest/src/stored-output-fixture.ts. The production check runs first, so the files the two share never
# decide the corpus check. Untracked files are not read: a file joins a graph only through an importer, and the
# first importer in that chain is tracked.
#
# Limit: a corpus change beside an output-neutral edit to a production-graph file is red, which fails towards a
# needless rebuild. There is no fetch: any origin/main holding the branch point yields it as the merge-base. The
# `checks` job in .github/workflows/ci.yml checks out full history so that merge-base exists there.
#
# Usage: bash .claude/scripts/check-stored-output-pin.sh [REPO_ROOT]   (or `pnpm check:stored-output-pin`)
# Exit:  0 pass, 1 the re-record owes a SCHEMA_VERSION bump, 2 no verdict (no merge-base, no readable pin or
#        SCHEMA_VERSION, no esbuild, an import graph that cannot be read).
set -uo pipefail
# Homebrew's prefix, for node on this machine; check-node-types.sh's comment on this line says why it prepends.
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
TOOLROOT=$(cd "$SCRIPT_DIR/../.." && pwd -P) || exit 2
ROOT=${1:-$TOOLROOT}

PIN_FILE=packages/ingest/src/stored-output-pin.test.ts
SCHEMA_FILE=packages/index/src/schema.ts
PRODUCTION_ENTRY=packages/ingest/src/index.ts
CORPUS_ENTRY=packages/ingest/src/stored-output-fixture.ts
MANIFEST=packages/ingest/package.json

refuse() {
  printf 'check-stored-output-pin: %s — no verdict\n' "$1" >&2
  exit 2
}

[ -d "$ROOT" ] || refuse "not a directory: $ROOT"
ROOT=$(cd "$ROOT" && pwd -P) || exit 2
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

# pin_digest -> the digest inside `const PIN = { … }` read from stdin; the block ends at the first `}` after its `= {`.
pin_digest() {
  local block
  block=$(awk '/^(export )?const PIN(: [^=]+)? = \{/ { on = 1; sub(/^[^=]*= \{/, "") } on { printf "%s ", $0; if (index($0, "}")) exit }')
  [[ $block =~ digest:\ *[\'\"\`]([0-9a-f]{64})[\'\"\`] ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

# schema_version -> the integer SCHEMA_VERSION is declared as in the module on stdin.
schema_version() {
  local found
  found=$(sed -nE 's/^export const SCHEMA_VERSION(: number)? = ([0-9]+);?$/\2/p')
  [[ $found =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$found"
}

base=$(git -C "$ROOT" merge-base HEAD refs/remotes/origin/main 2>/dev/null) ||
  refuse "no merge-base between HEAD and origin/main under $ROOT (no origin/main, or a shallow clone)"
short=${base:0:12}

if ! git -C "$ROOT" cat-file -e "$base:$PIN_FILE" 2>/dev/null; then
  printf 'check-stored-output-pin: OK — %s holds no pin to have moved\n' "$short"
  exit 0
fi
base_digest=$(git -C "$ROOT" show "$base:$PIN_FILE" | pin_digest) || refuse "cannot read PIN.digest from $PIN_FILE at $short"
head_digest=$(pin_digest <"$ROOT/$PIN_FILE") || refuse "cannot read PIN.digest from $PIN_FILE in the working tree"

if [ "$base_digest" = "$head_digest" ]; then
  printf 'check-stored-output-pin: OK — PIN.digest unchanged since %s\n' "$short"
  exit 0
fi

base_version=$(git -C "$ROOT" show "$base:$SCHEMA_FILE" 2>/dev/null | schema_version) ||
  refuse "cannot read SCHEMA_VERSION from $SCHEMA_FILE at $short"
head_version=$(schema_version <"$ROOT/$SCHEMA_FILE") || refuse "cannot read SCHEMA_VERSION from $SCHEMA_FILE in the working tree"

if [ "$head_version" -gt "$base_version" ]; then
  printf 'check-stored-output-pin: OK — PIN.digest moved with SCHEMA_VERSION %s -> %s\n' "$base_version" "$head_version"
  exit 0
fi

ESBUILD="$TOOLROOT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || refuse "no esbuild at $ESBUILD (run pnpm install)"

# graph <entry> -> every file esbuild bundles from <entry>, repo-relative, one per line.
graph() {
  (cd "$ROOT" && "$ESBUILD" "$1" --bundle --platform=node --format=esm --log-level=error \
    --metafile="$TMP/meta.json" --outdir="$TMP/out") >&2 &&
    node -e 'const { inputs } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(Object.keys(inputs).map((p) => p + "\n").join(""));' "$TMP/meta.json"
}

graph "$PRODUCTION_ENTRY" >"$TMP/production" || refuse "could not read the import graph of $PRODUCTION_ENTRY"
printf '%s\n' "$MANIFEST" >>"$TMP/production"
graph "$CORPUS_ENTRY" >"$TMP/corpus" || refuse "could not read the import graph of $CORPUS_ENTRY"
git -C "$ROOT" diff --name-only "$base" >"$TMP/changed" || refuse "git diff --name-only $short failed"

ingest_changed=$(grep -Fx -f "$TMP/production" "$TMP/changed")
corpus_changed=$(grep -Fx -f "$TMP/corpus" "$TMP/changed")
moved="PIN.digest moved since $short with SCHEMA_VERSION still $head_version"
bump="Courses indexed earlier keep their old records until SCHEMA_VERSION in $SCHEMA_FILE rises: raise it, then re-record PIN."

if [ -n "$ingest_changed" ]; then
  printf 'check-stored-output-pin: %s, and these files of ingest'\''s production graph changed:\n' "$moved" >&2
  printf '%s\n' "$ingest_changed" | sed 's/^/  /' >&2
  printf '%s\n' "$bump" >&2
  exit 1
fi
if [ -z "$corpus_changed" ]; then
  printf 'check-stored-output-pin: %s, and no file of the pin'\''s corpus changed, so ingest'\''s output moved for a reason outside both graphs.\n' "$moved" >&2
  printf '%s\n' "$bump" >&2
  exit 1
fi
printf 'check-stored-output-pin: OK — a corpus-only re-record: %s\n' "$(printf '%s\n' "$corpus_changed" | paste -sd ' ' -)"
