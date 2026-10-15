#!/usr/bin/env bash
# Test harness for check-no-network-egress.sh, its neighbour in this directory.
#
# Fixtures are fake installed trees under the temp tree `harness_init_tmp` makes: package
# directories laid out as pnpm lays them out, and a `pnpm ls --json` document describing
# them, handed to the gate through --ls-json. One case runs the gate with no arguments, so
# the shipped `pnpm ls` call is exercised against the real repo (docs/standards/testing.md
# rule 7).
#
# Usage: bash .claude/scripts/check-no-network-egress.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-no-network-egress.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

# --- fixtures ----------------------------------------------------------------------------

# fixture <name> -> sets DIR to a fresh root holding an allow-list with no entries.
fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/.claude" "$DIR/packages/app"
  printf '# no entries\n' >"$DIR/.claude/network-egress.allowlist" || exit 2
}

pkg_dir() { # pkg_dir <name> -> where pnpm would install it
  printf '%s/node_modules/.pnpm/%s@1.0.0/node_modules/%s' "$DIR" "${1//\//+}" "$1"
}

pkg() { # pkg <name> <relative file> <content>
  local file
  file="$(pkg_dir "$1")/$2"
  must mkdir -p "$(dirname "$file")"
  printf '%s\n' "$3" >"$file" || exit 2
}

dep() { # dep <name> [<nested dep fragment>] -> one `pnpm ls --json` dependency entry
  local nested=""
  [ -z "${2:-}" ] || nested=",\"dependencies\":{$2}"
  printf '"%s":{"from":"%s","version":"1.0.0","path":"%s"%s}' "$1" "$1" "$(pkg_dir "$1")" "$nested"
}

tree() { # tree <dependency fragment> [<declared name>...] -> ls.json, and a manifest declaring the names
  local fragment="$1" declared="" name
  shift
  for name in "$@"; do
    declared="$declared${declared:+,}\"$name\":\"1.0.0\""
  done
  printf '{"name":"app","dependencies":{%s}}\n' "$declared" >"$DIR/packages/app/package.json" || exit 2
  printf '[{"name":"app","path":"%s","dependencies":{%s}}]\n' "$DIR/packages/app" "$fragment" \
    >"$DIR/ls.json" || exit 2
}

allow() { # allow <line> — appends one line to the fixture's allow-list
  printf '%s\n' "$1" >>"$DIR/.claude/network-egress.allowlist" || exit 2
}

run_check() {
  capture bash "$CHECK" --ls-json "$DIR/ls.json" "$DIR"
}

# ==========================================================================================
# 1. the gate parses
# ==========================================================================================
begin "check-no-network-egress.sh parses (bash -n)"
expect_parses "$CHECK"
end

# ==========================================================================================
# 2. the real repo, via the shipped default path (no arguments, a real `pnpm ls`)
# ==========================================================================================
begin "the repo's own production tree passes with no arguments"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$CHECK"
  expect_rc 0 "$rc"
  expect_stdout "check-no-network-egress: OK"
  expect_not_out "unbound variable"
done
case_ctx=""
end

# ==========================================================================================
# 3. near misses pass
# ==========================================================================================
begin "member calls, string literals, lookalike names and non-JS files pass"
fixture near_miss
pkg clean index.js 'const hit = cache.fetch(key); prefetch(a); fetcher(b);
const scheme = "https"; const WebSocketish = 1;
const errors = require("http-errors"); const local = require("./http");'
pkg clean index.d.ts 'import "http"; declare function fetch(u: string): void;'
pkg clean README.md 'Call fetch(url) or new WebSocket(url).'
tree "$(dep clean)" clean
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  capture "$interpreter" "$CHECK" --ls-json "$DIR/ls.json" "$DIR"
  expect_rc 0 "$rc"
  expect_stdout "OK — 1 production package(s) scanned, 0 network-capable"
  expect_not_out "ERROR"
done
case_ctx=""
end

# ==========================================================================================
# 4. every arm, and every way into it
# ==========================================================================================
begin "every socket and process-spawn builtin is detected, in every import form"
fixture builtin
pkg b-require-http index.js 'const http = require("http");'
pkg b-node-https index.js "const https = require('node:https');"
pkg b-import-net index.mjs 'import net from "net";'
pkg b-dynamic-dgram index.js 'const dgram = await import("node:dgram");'
pkg b-minified-spawn dist/x.js 'import{spawn}from"child_process";'
pkg b-dns-promises index.js "import dns from 'node:dns/promises';"
pkg b-spaced-tls lib/index.cjs 'const tls = require ( "tls" );'
pkg b-reexport-http2 index.js 'export * from "http2";'
names=(b-require-http b-node-https b-import-net b-dynamic-dgram b-minified-spawn b-dns-promises
  b-spaced-tls b-reexport-http2)
fragment=""
for name in "${names[@]}"; do
  fragment="$fragment${fragment:+,}$(dep "$name")"
done
tree "$fragment" "${names[@]}"
run_check
expect_rc 1 "$rc"
expect_stderr "8 problem(s)"
for name in "${names[@]}"; do
  expect_stderr "ERROR $name@1.0.0 can reach the network and is not allow-listed — builtin:"
done
expect_not_stdout "check-no-network-egress: OK"
end

begin "every network global is detected"
fixture global
pkg g-fetch index.js 'const response = await fetch(url);'
pkg g-globalthis index.js 'const f = globalThis.fetch'
pkg g-window index.js 'window.fetch(url);'
pkg g-websocket dist/x.mjs 'const socket = new WebSocket(url);'
pkg g-xhr index.js 'const request = new XMLHttpRequest();'
pkg g-eventsource index.js 'const events = new EventSource(url);'
pkg g-beacon index.js 'navigator.sendBeacon(url, body);'
names=(g-fetch g-globalthis g-window g-websocket g-xhr g-eventsource g-beacon)
fragment=""
for name in "${names[@]}"; do
  fragment="$fragment${fragment:+,}$(dep "$name")"
done
tree "$fragment" "${names[@]}"
run_check
expect_rc 1 "$rc"
expect_stderr "7 problem(s)"
for name in "${names[@]}"; do
  expect_stderr "ERROR $name@1.0.0 can reach the network and is not allow-listed — global:"
done
end

begin "a native addon is detected — a source scan cannot read it"
fixture native
pkg n-addon build/Release/addon.node 'binary'
pkg n-gyp binding.gyp '{}'
tree "$(dep n-addon),$(dep n-gyp)" n-addon n-gyp
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR n-addon@1.0.0 can reach the network and is not allow-listed — native: build/Release/addon.node"
expect_stderr "ERROR n-gyp@1.0.0 can reach the network and is not allow-listed — native: binding.gyp"
end

# ==========================================================================================
# 5. the census: transitive, deduplicated, workspace links and unsaved entries skipped
# ==========================================================================================
begin "a transitive dependency is scanned, once however often it appears"
fixture transitive
pkg outer index.js 'module.exports = 1;'
pkg inner index.js 'fetch(url);'
tree "$(dep outer "$(dep inner)"),$(dep inner)" outer inner
run_check
expect_rc 1 "$rc"
expect_stderr "1 problem(s)"
[ "$(printf '%s\n' "$err" | grep -c 'ERROR inner@1.0.0')" -eq 1 ] ||
  bad "expected exactly one ERROR for inner; got: $err"
end

# pnpm expands one occurrence of a repeated path and marks the rest `deduped`, in its own
# order: here the walk meets the truncated `mid` first.
begin "a package met first as a deduped occurrence still has its dependencies scanned"
fixture deduped_first
pkg outer index.js 'module.exports = 1;'
pkg mid index.js 'module.exports = 2;'
pkg leaky index.js 'require("net");'
tree "$(dep outer "$(dep mid)"),$(dep mid "$(dep leaky)")" outer mid
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR leaky@1.0.0 can reach the network and is not allow-listed — builtin:"
end

begin "a dependency bundled under a package's own node_modules is scanned as that package"
fixture bundled
pkg host index.js 'module.exports = require("bundled");'
pkg host node_modules/bundled/index.js 'require("https");'
tree "$(dep host)" host
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR host@1.0.0 can reach the network and is not allow-listed — builtin: node_modules/bundled/index.js"
end

begin "a workspace link is not scanned, its dependencies are; unsaved entries are ignored"
fixture links
must mkdir -p "$DIR/packages/lib"
printf 'fetch(url);\n' >"$DIR/packages/lib/index.js" || exit 2
pkg deep index.js 'require("net");'
pkg stray index.js 'fetch(url);'
tree "\"lib\":{\"from\":\"lib\",\"version\":\"link:../lib\",\"path\":\"$DIR/packages/lib\",\"dependencies\":{$(dep deep)}}" lib
printf '[{"name":"app","path":"%s","dependencies":{%s},"unsavedDependencies":{%s}}]\n' \
  "$DIR/packages/app" \
  "\"lib\":{\"from\":\"lib\",\"version\":\"link:../lib\",\"path\":\"$DIR/packages/lib\",\"dependencies\":{$(dep deep)}}" \
  "$(dep stray)" >"$DIR/ls.json" || exit 2
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR deep@1.0.0"
expect_not_stderr "lib@"
expect_not_stderr "stray"
end

begin "a project's optional dependencies are scanned"
fixture optional
pkg opt index.js 'require("https");'
tree "" opt
printf '[{"name":"app","path":"%s","dependencies":{},"optionalDependencies":{%s}}]\n' \
  "$DIR/packages/app" "$(dep opt)" >"$DIR/ls.json" || exit 2
printf '{"name":"app","optionalDependencies":{"opt":"1.0.0"}}\n' >"$DIR/packages/app/package.json" || exit 2
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR opt@1.0.0"
end

# ==========================================================================================
# 6. the allow-list
# ==========================================================================================
begin "an allow-listed package passes and is printed with its evidence"
fixture allowed
pkg @scope/backend index.js 'await fetch(url);'
tree "$(dep @scope/backend)" @scope/backend
allow "@scope/backend the local model backend adapter, bound to localhost"
run_check
expect_rc 0 "$rc"
expect_stdout "allowed @scope/backend@1.0.0 — global: index.js:1:"
expect_stdout "OK — 1 production package(s) scanned, 1 network-capable, all allow-listed"
end

begin "an entry with no reason fails"
fixture no_reason
pkg backend index.js 'await fetch(url);'
tree "$(dep backend)" backend
allow "backend"
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR backend is allow-listed with no reason"
expect_not_stderr "not allow-listed"
end

begin "a stale entry fails, whether the package left the tree or stopped being detected"
fixture stale
pkg clean index.js 'module.exports = 1;'
tree "$(dep clean)" clean
allow "clean once fetched its data"
allow "gone a dependency since removed"
run_check
expect_rc 1 "$rc"
expect_stderr "ERROR clean is allow-listed but the scan no longer detects it"
expect_stderr "ERROR gone is allow-listed but is not a production dependency"
end

begin "an unreadable allow-list is exit 2: missing, a bad name, a duplicate"
fixture missing_list
tree ""
must rm "$DIR/.claude/network-egress.allowlist"
run_check
expect_rc 2 "$rc"
expect_stderr "no allow-list at"
fixture bad_name
tree ""
allow "Not_A_Name! some reason"
run_check
expect_rc 2 "$rc"
expect_stderr "BLOCKED line 2: not an npm package name: 'Not_A_Name!'"
fixture duplicate
tree ""
allow "backend one reason"
allow "backend another reason"
run_check
expect_rc 2 "$rc"
expect_stderr "BLOCKED line 3: 'backend' is listed twice"
end

# ==========================================================================================
# 7. an uninstalled tree is exit 2, not a clean scan
# ==========================================================================================
begin "a declared dependency missing from the installed tree is exit 2"
fixture uninstalled
tree "" ghost
run_check
expect_rc 2 "$rc"
expect_stderr "app declares ghost, which is not installed"
expect_not_stdout "OK"
end

begin "an uninstalled platform variant of a parent's optional dependency is skipped"
fixture platform_variant
pkg native-host package.json '{"optionalDependencies":{"native-host-linux-x64":"1.0.0"}}'
pkg native-host index.js 'module.exports = 1;'
tree "$(dep native-host "$(dep native-host-linux-x64)")" native-host
run_check
expect_rc 0 "$rc"
expect_stdout "OK — 1 production package(s) scanned"
end

begin "a package file the scan cannot read is exit 2, not a clean scan"
fixture unreadable
pkg locked index.js 'module.exports = 1;'
must chmod 000 "$(pkg_dir locked)/index.js"
tree "$(dep locked)" locked
run_check
expect_rc 2 "$rc"
expect_stderr "grep failed in"
expect_not_stdout "OK"
end

begin "a listed package directory that does not exist is exit 2"
fixture vanished
tree "$(dep vanished)" vanished
run_check
expect_rc 2 "$rc"
expect_stderr "vanished: installed path missing"
end

# ==========================================================================================
# 8. a wrong invocation is exit 2, not a verdict
# ==========================================================================================
begin "a non-directory root and a missing --ls-json operand are invocation errors"
capture bash "$CHECK" "$TMP_ROOT/does-not-exist"
expect_rc 2 "$rc"
expect_stderr "not a directory"
capture bash "$CHECK" --ls-json
expect_rc 2 "$rc"
expect_stderr "--ls-json needs a file"
end

finish
