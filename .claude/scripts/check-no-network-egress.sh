#!/usr/bin/env bash
# Network-egress gate: every production dependency that can open a socket is named, with a
# reason, in .claude/network-egress.allowlist — and nothing else is.
#
# CLAUDE.md § Hard constraints: no course content leaves the machine. A dependency that can
# reach the network is how it would, so each one is an owner decision, recorded in a file
# `.claude/workflow.json` → `merge.humanAlways` lists.
#
# CENSUS. Every transitive production dependency of every workspace importer, as
# `pnpm ls -r --prod --json --depth Infinity` reports the installed tree, walked with `node`
# (check-node-types.sh states why JSON is not read in bash). Workspace packages are not
# third-party and are not scanned (first-party network code is review's to hold); their
# dependencies are. A dependency a manifest declares
# that the installed tree lacks is exit 2: an uninstalled tree scans clean, and that is a
# broken check, not a verdict.
#
# DETECTION is a static scan of each package's .js/.mjs/.cjs, bundled node_modules included,
# one arm per way in:
#   builtin  imports a socket or process-spawn builtin (BUILTIN_RE) — a spawned process can
#            reach the network on the package's behalf
#   global   uses a network global (GLOBAL_RE); a member call such as `cache.fetch(` is not one
#   native   ships a native addon (*.node, binding.gyp), which no source scan can read
# It is a floor: `require(name)` with a computed name evades it. A false positive is
# allow-listed with a reason that says so.
#
# THE ALLOW-LIST FORMAT (this header is its one owner). One entry per line:
# `<npm package name> <reason>`, the reason non-empty; `#` lines and blank lines ignored. It
# keys on the name, so one entry covers every installed version.
# Every site naming the allow-list's path is listed in
# .claude/ledgers/network-egress-allowlist-path.ledger: a move that misses `merge.humanAlways`
# lets entries auto-merge.
#
# Both directions fail (exit 1): a detected package with no entry, an entry with no reason,
# and an entry naming a package the scan no longer detects — the check-ledgers.sh rule, so
# the list stays a description of the tree rather than a history of it. A missing allow-list
# or a line it cannot parse is exit 2.
#
# Usage: bash .claude/scripts/check-no-network-egress.sh [--ls-json FILE] [REPO_ROOT]
#        (or `pnpm check:no-network-egress`)
#        REPO_ROOT defaults to the repo root above this script. --ls-json reads FILE in place
#        of running `pnpm ls`, so the harness can hand the walker fixture trees.
# Exit:  0 the allow-list matches the scan, 1 it does not, 2 the gate reached no verdict.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2

BUILTIN_RE="(require|from|import)[[:space:]]*\\(?[[:space:]]*['\"](node:)?(net|http|https|http2|tls|dgram|dns|dns/promises|child_process)['\"]"
GLOBAL_RE='(^|[^.[:alnum:]_$])fetch[[:space:]]*\(|(globalThis|window|self|global)\.fetch([^[:alnum:]_$]|$)|(^|[^[:alnum:]_$])(WebSocket|XMLHttpRequest|EventSource)([^[:alnum:]_$]|$)|sendBeacon'
NAME_RE='^(@[a-z0-9._~-]+/)?[a-z0-9._~-]+$'

ls_json=""
root_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ls-json)
      [ $# -ge 2 ] || {
        printf 'check-no-network-egress: --ls-json needs a file\n' >&2
        exit 2
      }
      ls_json=$2
      shift 2
      ;;
    *)
      root_arg=$1
      shift
      ;;
  esac
done

ROOT=${root_arg:-"$SCRIPT_DIR/../.."}
if [ ! -d "$ROOT" ]; then
  printf 'check-no-network-egress: not a directory: %s\n' "$ROOT" >&2
  exit 2
fi
ROOT=$(cd "$ROOT" && pwd -P) || exit 2
ALLOWLIST="$ROOT/.claude/network-egress.allowlist"
if [ ! -f "$ALLOWLIST" ]; then
  printf 'check-no-network-egress: no allow-list at %s\n' "$ALLOWLIST" >&2
  exit 2
fi

SCRATCH=$(mktemp -d) || exit 2
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

if [ -n "$ls_json" ]; then
  cp "$ls_json" "$SCRATCH/ls.json" || exit 2
elif ! (cd "$ROOT" && pnpm -r ls --prod --json --depth Infinity) >"$SCRATCH/ls.json" 2>"$SCRATCH/ls.err"; then
  printf 'check-no-network-egress: pnpm ls failed: %s\n' "$(head -n1 "$SCRATCH/ls.err")" >&2
  exit 2
fi

# Prints `name<TAB>version<TAB>dir` once per third-party package directory.
WALK_PROGRAM=''
IFS= read -r -d '' WALK_PROGRAM <<'NODE' || true
'use strict';
const fs = require("node:fs");
const path = require("node:path");
const projects = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const seen = new Set();
const problems = [];
const optionalOf = (dir) => {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")).optionalDependencies || {};
};
// pnpm marks a repeat occurrence `deduped` and expands only one of them, in an order
// that is not this walk's, so a seen path is skipped for emission but always walked.
const walk = (deps, parentDir) => {
  for (const [name, dep] of Object.entries(deps || {})) {
    const dir = dep.path || "";
    if (dir.split(path.sep).includes("node_modules")) {
      if (!fs.existsSync(dir)) {
        // pnpm lists every platform variant of an optional binary; only one installs.
        if (!(name in optionalOf(parentDir))) {
          problems.push(`${name}: installed path missing: ${dir}`);
        }
        continue;
      }
      if (!seen.has(dir)) {
        seen.add(dir);
        process.stdout.write(`${name}\t${dep.version}\t${dir}\n`);
      }
    }
    walk(dep.dependencies, dir);
    walk(dep.optionalDependencies, dir);
  }
};
for (const project of projects) {
  const manifest = JSON.parse(fs.readFileSync(path.join(project.path, "package.json"), "utf8"));
  for (const name of Object.keys(manifest.dependencies || {})) {
    if (!(project.dependencies || {})[name]) {
      problems.push(`${project.name || project.path} declares ${name}, which is not installed`);
    }
  }
  walk(project.dependencies, project.path);
  walk(project.optionalDependencies, project.path);
}
if (problems.length) {
  for (const p of problems) process.stderr.write(`check-no-network-egress: ${p}\n`);
  process.stderr.write("check-no-network-egress: run pnpm install --frozen-lockfile, then re-run\n");
  process.exit(2);
}
NODE

node -e "$WALK_PROGRAM" "$SCRATCH/ls.json" >"$SCRATCH/census.tsv" || exit 2

# first_hit <dir> <ERE> — prints the first `file:line: text` in dir's JS matching ERE.
# Returns 2 when grep could not read the package: an unread file is not a clean one.
first_hit() {
  grep -rnIE --include='*.js' --include='*.mjs' --include='*.cjs' -e "$2" "$1" \
    >"$SCRATCH/hits" 2>"$SCRATCH/hits.err"
  if [ $? -gt 1 ]; then
    printf 'check-no-network-egress: grep failed in %s: %s\n' "$1" "$(head -n1 "$SCRATCH/hits.err")" >&2
    return 2
  fi
  head -n1 "$SCRATCH/hits" | cut -c1-200
}

# first_native <dir> — prints the first native-addon file under dir; 2 when find failed.
first_native() {
  if ! find "$1" -type f \( -name '*.node' -o -name binding.gyp \) >"$SCRATCH/hits" 2>"$SCRATCH/hits.err"; then
    printf 'check-no-network-egress: find failed in %s: %s\n' "$1" "$(head -n1 "$SCRATCH/hits.err")" >&2
    return 2
  fi
  head -n1 "$SCRATCH/hits"
}

scanned=0
: >"$SCRATCH/detected.tsv"
while IFS="$(printf '\t')" read -r name version dir; do
  scanned=$((scanned + 1))
  hit=$(first_hit "$dir" "$BUILTIN_RE") || exit 2
  arm=builtin
  if [ -z "$hit" ]; then
    hit=$(first_hit "$dir" "$GLOBAL_RE") || exit 2
    arm=global
  fi
  if [ -z "$hit" ]; then
    hit=$(first_native "$dir") || exit 2
    arm=native
  fi
  if [ -n "$hit" ]; then
    printf '%s\t%s\t%s\t%s\n' "$name" "$version" "$arm" "${hit#"$dir"/}" >>"$SCRATCH/detected.tsv"
  fi
done <"$SCRATCH/census.tsv"

blockers=()
errors=()
: >"$SCRATCH/allowed.names"
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  case "$line" in
    '#'* | '') continue ;;
  esac
  name=${line%%[[:space:]]*}
  reason=${line#"$name"}
  reason=${reason#"${reason%%[![:space:]]*}"}
  if ! [[ $name =~ $NAME_RE ]]; then
    blockers+=("line $lineno: not an npm package name: '$name'")
  elif grep -qxF -- "$name" "$SCRATCH/allowed.names"; then
    blockers+=("line $lineno: '$name' is listed twice")
  else
    printf '%s\n' "$name" >>"$SCRATCH/allowed.names"
    [ -n "$reason" ] || errors+=("$name is allow-listed with no reason")
  fi
done <"$ALLOWLIST"

if [ ${#blockers[@]} -ne 0 ]; then
  printf '\ncheck-no-network-egress: %s could not be read\n' "$ALLOWLIST" >&2
  for blocker in "${blockers[@]}"; do
    printf '  BLOCKED %s\n' "$blocker" >&2
  done
  exit 2
fi

allowed=()
while IFS="$(printf '\t')" read -r name version arm hit; do
  if grep -qxF -- "$name" "$SCRATCH/allowed.names"; then
    allowed+=("  allowed $name@$version — $arm: $hit")
  else
    errors+=("$name@$version can reach the network and is not allow-listed — $arm: $hit")
  fi
done <"$SCRATCH/detected.tsv"

while IFS= read -r name; do
  if ! cut -f1 "$SCRATCH/detected.tsv" | grep -qxF -- "$name"; then
    if cut -f1 "$SCRATCH/census.tsv" | grep -qxF -- "$name"; then
      errors+=("$name is allow-listed but the scan no longer detects it — strike the entry")
    else
      errors+=("$name is allow-listed but is not a production dependency — strike the entry")
    fi
  fi
done <"$SCRATCH/allowed.names"

if [ ${#errors[@]} -ne 0 ]; then
  printf '\ncheck-no-network-egress: %d problem(s) with the network-egress allow-list\n' \
    "${#errors[@]}" >&2
  for item in "${errors[@]}"; do
    printf '  ERROR %s\n' "$item" >&2
  done
  printf '\nNo course content leaves the machine (CLAUDE.md § Hard constraints). Drop the\n' >&2
  printf 'dependency, or add a "<name> <reason>" line to .claude/network-egress.allowlist for the\n' >&2
  printf "owner's review.\n" >&2
  exit 1
fi

for item in ${allowed[@]+"${allowed[@]}"}; do
  printf '%s\n' "$item"
done
printf 'check-no-network-egress: OK — %d production package(s) scanned, %d network-capable, all allow-listed\n' \
  "$scanned" "${#allowed[@]}"
