#!/usr/bin/env bash
# Network-egress gate: every production dependency and every first-party source file that can
# open a socket is named, with a reason, in .claude/network-egress.allowlist — and nothing
# else is.
#
# CLAUDE.md § Hard constraints: no course content leaves the machine. Code that can reach the
# network is how it would, so each such dependency and module is an owner decision, recorded
# in a file `.claude/workflow.json` → `merge.humanAlways` lists.
#
# THIRD-PARTY CENSUS. Every transitive production dependency of every workspace importer, as
# `pnpm ls -r --prod --json --depth Infinity` reports the installed tree, walked with `node`
# (check-node-types.sh states why JSON is not read in bash). Workspace packages are not
# third-party and are not in it; their dependencies are. A listed dependency the installed
# tree lacks is exit 2 — an uninstalled tree scans clean, and that is a broken check, not a
# verdict — unless its parent declares it optional: pnpm lists every platform variant of an
# optional binary and installs one, so the others are absent, unscanned, and an entry naming
# one is not stale — unless the same name is installed under another parent, where that
# instance's scan decides (#182).
#
# FIRST-PARTY CENSUS (#165). Every .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs file git tracks, or
# holds untracked and not ignored, under each workspace importer but the root (repo tooling,
# not app code), except tests: a `.test.` or `.spec.` basename, the first-party counterpart of
# `--prod`. A tracked file deleted from the work tree is skipped. A git work tree is required:
# outside one the census cannot tell a source from a build output, and that is exit 2.
#
# DETECTION is a static scan of each package's .js/.mjs/.cjs, bundled node_modules included,
# and of each first-party source, one arm per way in:
#   builtin  imports a socket or process-spawn builtin (BUILTIN_RE) — a spawned process can
#            reach the network on the package's behalf
#   global   uses a network global (GLOBAL_RE); a member call such as `cache.fetch(` or
#            `this.#fetch(` is not one
#   native   ships a native addon (*.node, binding.gyp), which no source scan can read;
#            third-party only
# A first-party source is scanned with its `import type` and `export type` clauses blanked,
# line numbers kept, since TypeScript erases them; `import { type X }` stays, as it may not be.
# It is a floor: `require(name)` with a computed name evades it, and so does an optional
# dependency not installed on the platform the gate runs on, and so does a first-party module
# that reaches the network only by calling an allow-listed one. A false positive is
# allow-listed with a reason that says so.
#
# THE ALLOW-LIST FORMAT (this header is its one owner). One entry per line: `<key> <reason>`,
# the reason non-empty; `#` lines and blank lines ignored. The key is an npm package name,
# which covers every installed version, or a first-party source's path from the repo root —
# any key holding a `/` and not starting with `@`.
# Every site naming the allow-list's path is listed in
# .claude/ledgers/network-egress-allowlist-path.ledger: a move that misses `merge.humanAlways`
# lets entries auto-merge.
#
# Both directions fail (exit 1): a detected package or source with no entry, an entry with no
# reason, and an entry naming one the scan no longer detects — the check-ledgers.sh rule, so
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
GLOBAL_RE='(^|[^.#[:alnum:]_$])fetch[[:space:]]*\(|(globalThis|window|self|global)\.fetch([^[:alnum:]_$]|$)|(^|[^[:alnum:]_$])(WebSocket|XMLHttpRequest|EventSource)([^[:alnum:]_$]|$)|sendBeacon'
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

# Prints `name<TAB>version<TAB>dir` once per installed third-party package directory, and
# `name<TAB>version<TAB>-` for an absent optional one.
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
        if (name in optionalOf(parentDir)) process.stdout.write(`${name}\t${dep.version}\t-\n`);
        else problems.push(`${name}: installed path missing: ${dir}`);
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

# Prints each first-party source's repo-relative path, and writes its masked copy (the
# DETECTION paragraph above) to the same path under the mirror directory.
FIRST_PARTY_PROGRAM=''
IFS= read -r -d '' FIRST_PARTY_PROGRAM <<'NODE' || true
'use strict';
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const [lsJson, root, mirror] = process.argv.slice(1);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST = /\.(?:test|spec)\./;
const TYPE_ONLY =
  /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*(['"])[^'"\n]*\1/g;
const importers = JSON.parse(fs.readFileSync(lsJson, "utf8"))
  .map((project) => path.relative(root, fs.realpathSync(project.path)))
  .filter((dir) => dir !== "");
// With no pathspec, ls-files would list the whole repository.
if (importers.length === 0) process.exit(0);
let listed;
try {
  listed = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...importers],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 },
  );
} catch (error) {
  const detail = String(error.stderr || error.message).split("\n")[0];
  process.stderr.write(`check-no-network-egress: git ls-files failed: ${detail}\n`);
  process.exit(2);
}
for (const file of listed.split("\0")) {
  if (!SOURCE.test(file) || TEST.test(path.basename(file))) continue;
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  const text = fs.readFileSync(source, "utf8");
  const target = path.join(mirror, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text.replace(TYPE_ONLY, (clause) => clause.replace(/[^\n]/g, " ")));
  process.stdout.write(`${file}\n`);
}
NODE

node -e "$FIRST_PARTY_PROGRAM" "$SCRATCH/ls.json" "$ROOT" "$SCRATCH/first-party" \
  >"$SCRATCH/first-party.files" || exit 2

PACKAGE_JS=(-r --include='*.js' --include='*.mjs' --include='*.cjs')

# first_hit <path> <ERE> [grep option...] — prints the first `[file:]line:text` under path
# matching ERE. Returns 2 when grep could not read it: an unread file is not a clean one.
first_hit() {
  local target=$1 re=$2
  shift 2
  grep -nIE "$@" -e "$re" "$target" >"$SCRATCH/hits" 2>"$SCRATCH/hits.err"
  if [ $? -gt 1 ]; then
    printf 'check-no-network-egress: grep failed in %s: %s\n' "$target" "$(head -n1 "$SCRATCH/hits.err")" >&2
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
: >"$SCRATCH/absent.names"
while IFS="$(printf '\t')" read -r name version dir; do
  if [ "$dir" = "-" ]; then
    printf '%s\n' "$name" >>"$SCRATCH/absent.names"
    continue
  fi
  scanned=$((scanned + 1))
  hit=$(first_hit "$dir" "$BUILTIN_RE" "${PACKAGE_JS[@]}") || exit 2
  arm=builtin
  if [ -z "$hit" ]; then
    hit=$(first_hit "$dir" "$GLOBAL_RE" "${PACKAGE_JS[@]}") || exit 2
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

sources=0
: >"$SCRATCH/first-party-detected.tsv"
while IFS= read -r file; do
  sources=$((sources + 1))
  hit=$(first_hit "$SCRATCH/first-party/$file" "$BUILTIN_RE") || exit 2
  arm=builtin
  if [ -z "$hit" ]; then
    hit=$(first_hit "$SCRATCH/first-party/$file" "$GLOBAL_RE") || exit 2
    arm=global
  fi
  if [ -n "$hit" ]; then
    printf '%s\t%s\tline %s: %s\n' "$file" "$arm" "${hit%%:*}" "$(printf '%s' "${hit#*:}" | sed 's/^[[:space:]]*//' | cut -c1-200)" \
      >>"$SCRATCH/first-party-detected.tsv"
  fi
done <"$SCRATCH/first-party.files"

# is_path_key <key> — true when an allow-list key names a first-party source, not a package.
is_path_key() {
  case "$1" in
    @*) return 1 ;;
    */*) return 0 ;;
  esac
  return 1
}

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
  if ! is_path_key "$name" && ! [[ $name =~ $NAME_RE ]]; then
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
absent=()
while IFS="$(printf '\t')" read -r name version arm hit; do
  if grep -qxF -- "$name" "$SCRATCH/allowed.names"; then
    allowed+=("  allowed $name@$version — $arm: $hit")
  else
    errors+=("$name@$version can reach the network and is not allow-listed — $arm: $hit")
  fi
done <"$SCRATCH/detected.tsv"
while IFS="$(printf '\t')" read -r file arm hit; do
  if grep -qxF -- "$file" "$SCRATCH/allowed.names"; then
    allowed+=("  allowed $file — $arm: $hit")
  else
    errors+=("$file can reach the network and is not allow-listed — $arm: $hit")
  fi
done <"$SCRATCH/first-party-detected.tsv"

awk -F'\t' '$3 != "-" { print $1 }' "$SCRATCH/census.tsv" >"$SCRATCH/installed.names" || exit 2
while IFS= read -r name; do
  if is_path_key "$name"; then
    if cut -f1 "$SCRATCH/first-party-detected.tsv" | grep -qxF -- "$name"; then
      continue
    elif grep -qxF -- "$name" "$SCRATCH/first-party.files"; then
      errors+=("$name is allow-listed but the scan no longer detects it — strike the entry")
    else
      errors+=("$name is allow-listed but is not a first-party source the census reads — strike the entry")
    fi
    continue
  fi
  if ! cut -f1 "$SCRATCH/detected.tsv" | grep -qxF -- "$name"; then
    if grep -qxF -- "$name" "$SCRATCH/installed.names"; then
      errors+=("$name is allow-listed but the scan no longer detects it — strike the entry")
    elif grep -qxF -- "$name" "$SCRATCH/absent.names"; then
      absent+=("  absent $name — an optional dependency not installed on this platform")
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
  printf 'dependency or the connection, or add a "<name or path> <reason>" line to\n' >&2
  printf ".claude/network-egress.allowlist for the owner's review.\n" >&2
  exit 1
fi

for item in ${allowed[@]+"${allowed[@]}"} ${absent[@]+"${absent[@]}"}; do
  printf '%s\n' "$item"
done
printf 'check-no-network-egress: OK — %d production package(s) and %d first-party source(s) scanned, %d network-capable, all allow-listed\n' \
  "$scanned" "$sources" "${#allowed[@]}"
