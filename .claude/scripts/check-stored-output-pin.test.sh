#!/usr/bin/env bash
# Test harness for check-stored-output-pin.sh. Each case builds a repo with a bare origin whose main holds a
# miniature ingest — a production entry reaching a second package, a corpus module reaching a deck builder, a pin
# and a SCHEMA_VERSION — then changes it on a branch. The fixtures have no node_modules; the gate resolves esbuild
# from the repository holding it. One case runs the gate with no argument against this repository (testing.md
# rule 7).
#
# Usage: bash .claude/scripts/check-stored-output-pin.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
CHECK="$SCRIPTS/check-stored-output-pin.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

PIN=packages/ingest/src/stored-output-pin.test.ts
SCHEMA=packages/index/src/schema.ts

gitc() { # gitc <dir> <git args...> — identity per command, so no git config is read or written
  local dir="$1"
  shift
  git -C "$dir" -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"
}

digest() { # digest <hex char> -> 64 copies of it
  printf '%064d' 0 | tr 0 "$1"
}

put() { # put <path> <content>
  must mkdir -p "$(dirname "$DIR/$1")"
  must printf '%s\n' "$2" >"$DIR/$1"
}

pin() { # pin <hex char> -> the pin module, multi-line as prettier writes it
  put "$PIN" "const PIN = {
  schemaVersion: 8,
  digest: '$(digest "$1")',
};"
}

commit() {
  must gitc "$DIR" add -A
  must gitc "$DIR" commit --quiet -m "$1"
}

# fixture <name> -> DIR, a repo on branch `work` at an origin/main holding the miniature ingest. It imports a node
# builtin, a dependency from an ignored node_modules and awaits at top level, as the real entries do.
fixture() {
  DIR="$TMP_ROOT/$1"
  must git init --quiet --bare -b main "$DIR.origin.git"
  must git init --quiet -b main "$DIR"
  put packages/ingest/package.json '{ "name": "ingest" }'
  put packages/ingest/src/index.ts "export { read } from './read';"
  put .gitignore 'node_modules/'
  put packages/ingest/node_modules/dep/index.js 'export const dep = (s) => s;'
  put packages/ingest/src/read.ts "import { basename } from 'node:path';
import { dep } from 'dep';
import { trim } from '../../shared/src/text';
export const read = (s: string): string => dep(trim(basename(s)));"
  put packages/shared/src/text.ts 'export const trim = (s: string): string => s.trim();'
  put packages/ingest/src/stored-output-fixture.ts "import { deck } from './deck-fixture';
import { read } from './read';
const built = await Promise.resolve(deck);
export const corpus = (): string => read(built);"
  put packages/ingest/src/deck-fixture.ts "export const deck = ' a ';"
  put packages/ingest/src/read.test.ts "it('reads', () => {});"
  put "$SCHEMA" 'export const SCHEMA_VERSION = 8;'
  pin a
  commit base
  must gitc "$DIR" remote add origin "$DIR.origin.git"
  must gitc "$DIR" push --quiet origin main
  must gitc "$DIR" checkout --quiet -b work
}

run_check() {
  capture bash "$CHECK" "$@"
}

n=0 # suffixes the fixtures a looping case builds

begin "check-stored-output-pin.sh parses (bash -n)"
expect_parses "$CHECK"
end

begin "an unchanged digest passes, whatever else changed"
fixture unchanged
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
commit edit
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "check-stored-output-pin: OK — PIN.digest unchanged"
end

begin "a moved digest passes when SCHEMA_VERSION rose"
fixture bumped
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
put "$SCHEMA" 'export const SCHEMA_VERSION = 9;'
pin b
commit bump
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "SCHEMA_VERSION 8 -> 9"
end

begin "a corpus-only re-record passes and names the corpus files"
fixture corpus_only
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
put packages/ingest/src/read.test.ts "it('reads again', () => {});"
put packages/ingest/src/read.ts.orig 'a merge leftover'
put packages/ingest/src/read_ts 'a name that matches read.ts only as a regex'
pin b
commit corpus
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "check-stored-output-pin: OK — a corpus-only re-record: packages/ingest/src/deck-fixture.ts"
expect_not_stdout "read.test.ts"
end

begin "a moved digest over a changed production file fails and names it"
fixture production
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/read.ts"
expect_not_stderr "deck-fixture.ts"
expect_stderr "SCHEMA_VERSION still 8"
end

begin "the corpus entry itself is corpus, and a production file it imports is not"
fixture corpus_entry
put packages/ingest/src/stored-output-fixture.ts "import { read } from './read';
export const corpus = (): string => read(' b ');"
pin b
commit corpus
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "re-record: packages/ingest/src/stored-output-fixture.ts"
end

begin "a file of another package that the production entry reaches counts as ingest"
fixture shared
put packages/shared/src/text.ts 'export const trim = (s: string): string => s;'
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/shared/src/text.ts"
end

begin "what fixes node_modules and the runtime counts as ingest"
for resolution in packages/ingest/package.json pnpm-lock.yaml .nvmrc; do
  case_ctx="$resolution"
  n=$((n + 1))
  fixture "resolution_$n"
  put "$resolution" '{ "name": "ingest", "version": "1.0.0" }'
  put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
  pin b
  commit edit
  run_check "$DIR"
  expect_rc 1 "$rc"
  expect_stderr "  $resolution"
done
end

begin "a production file with a non-ASCII name is matched"
fixture non_ascii
put packages/ingest/src/café.ts "export const accent = (s: string): string => s;"
put packages/ingest/src/index.ts "export { read } from './read';
export { accent } from './café';"
commit accent
must gitc "$DIR" push --quiet origin work:main
must gitc "$DIR" fetch --quiet origin
put packages/ingest/src/café.ts "export const accent = (s: string): string => s.trim();"
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/café.ts"
end

begin "an untracked file that takes over an import's resolution counts as ingest"
fixture untracked
must mkdir -p "$DIR/packages/ingest/src/né"
put packages/ingest/src/né/index.ts "export const x = 1;"
put packages/ingest/src/index.ts "export { read } from './read';
export { x } from './né';"
commit x
must gitc "$DIR" push --quiet origin work:main
must gitc "$DIR" fetch --quiet origin
put packages/ingest/src/né.ts "export const x = 2;"
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
pin b
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/né.ts"
end

begin "a renamed production file is matched by its new path"
fixture renamed
must gitc "$DIR" mv packages/ingest/src/read.ts packages/ingest/src/reader.ts
put packages/ingest/src/index.ts "export { read } from './reader';"
put packages/ingest/src/stored-output-fixture.ts "import { deck } from './deck-fixture';
import { read } from './reader';
const built = await Promise.resolve(deck);
export const corpus = (): string => read(built);"
pin b
commit rename
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/reader.ts"
end

begin "a moved digest with no corpus change fails, even when only a test file changed"
fixture no_corpus
put packages/ingest/src/read.test.ts "it('reads again', () => {});"
put packages/ingest/src/deck-fixture.ts.orig 'a merge leftover'
put packages/ingest/src/deck-fixture_ts 'a name that matches deck-fixture.ts only as a regex'
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "no file of the pin's corpus changed"
end

begin "an uncommitted edit in the working tree is read"
fixture uncommitted
put packages/ingest/src/deck-fixture.ts "export const deck = ' b ';"
pin b
commit corpus
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/read.ts"
end

begin "a lowered SCHEMA_VERSION is not a bump"
fixture lowered
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
put "$SCHEMA" 'export const SCHEMA_VERSION = 7;'
pin b
commit lower
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "SCHEMA_VERSION still 7"
end

begin "an unchanged SCHEMA_VERSION declared with a type annotation and no semicolon is read"
fixture annotated
put "$SCHEMA" 'export const SCHEMA_VERSION: number = 8'
commit annotate
must gitc "$DIR" push --quiet origin work:main
must gitc "$DIR" fetch --quiet origin
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "SCHEMA_VERSION still 8"
end

begin "a SCHEMA_VERSION declaration in a comment is not read"
fixture commented_schema
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
put "$SCHEMA" '// export const SCHEMA_VERSION = 9;
export const SCHEMA_VERSION = 8;'
pin b
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "SCHEMA_VERSION still 8"
end

begin "a PIN declaration in a comment is not read"
fixture commented_pin
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
put "$PIN" "// const PIN = { schemaVersion: 8, digest: '$(digest a)' };
const PIN = {
  schemaVersion: 8,
  digest: '$(digest b)',
};"
commit edit
run_check "$DIR"
expect_rc 1 "$rc"
expect_stderr "  packages/ingest/src/read.ts"
end

begin "a base with no pin passes"
fixture no_base_pin
must gitc "$DIR" checkout --quiet main
must gitc "$DIR" rm --quiet "$PIN"
commit unpin
must gitc "$DIR" push --quiet origin main
must gitc "$DIR" checkout --quiet -B work
pin b
commit pin
run_check "$DIR"
expect_rc 0 "$rc"
expect_stdout "check-stored-output-pin: OK — "
expect_stdout "holds no pin"
end

begin "every way of writing the PIN declaration is read"
for form in \
  "const PIN = { schemaVersion: 8, digest: '$(digest b)' };" \
  "export const PIN = {
  digest: \"$(digest b)\",
  schemaVersion: 8,
};" \
  "const PIN: { schemaVersion: number; digest: string } = {
  schemaVersion: 8,
  digest: \`$(digest b)\`,
} as const;" \
  "const PIN = { schemaVersion: 8, digest:'$(digest b)' };"; do
  case_ctx="$form"
  n=$((n + 1))
  fixture "form_$n"
  put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
  put "$PIN" "$form"
  commit edit
  run_check "$DIR"
  expect_rc 1 "$rc"
  expect_stderr "  packages/ingest/src/read.ts"
done
end

begin "a digest that is not 64 lowercase hex characters is unreadable"
for bad_digest in "$(digest b | cut -c2-)" "$(digest b)b" "$(digest B)" "$(digest g)"; do
  case_ctx="$bad_digest"
  n=$((n + 1))
  fixture "bad_digest_$n"
  put "$PIN" "const PIN = {
  schemaVersion: 8,
  digest: '$bad_digest',
};"
  run_check "$DIR"
  expect_rc 2 "$rc"
  expect_stderr "cannot read PIN.digest"
done
end

begin "a digest outside the PIN block is not read as the pin's"
fixture outside_block
put "$PIN" "const PIN = {
  schemaVersion: 8,
};
const OTHER = { digest: '$(digest b)' };"
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "cannot read PIN.digest from $PIN in the working tree"
end

begin "an unreadable pin at the base is no verdict"
fixture bad_base_pin
put "$PIN" 'const PIN = { schemaVersion: 8 };'
commit unpin
must gitc "$DIR" push --quiet origin work:main
must gitc "$DIR" fetch --quiet origin
pin b
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "cannot read PIN.digest from $PIN at "
end

begin "an unreadable SCHEMA_VERSION at the base is no verdict"
fixture bad_base_schema
put "$SCHEMA" 'export let SCHEMA_VERSION = 8;'
commit unschema
must gitc "$DIR" push --quiet origin work:main
must gitc "$DIR" fetch --quiet origin
put "$SCHEMA" 'export const SCHEMA_VERSION = 8;'
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
pin b
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "cannot read SCHEMA_VERSION from $SCHEMA at "
end

begin "no pin in the working tree is no verdict"
fixture no_head_pin
must rm "$DIR/$PIN"
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "cannot read PIN.digest"
end

begin "an unreadable SCHEMA_VERSION is no verdict"
fixture bad_schema
put "$SCHEMA" 'export let SCHEMA_VERSION = 9;'
pin b
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "cannot read SCHEMA_VERSION from $SCHEMA in the working tree"
end

begin "a root that is not a directory is no verdict"
run_check "$TMP_ROOT/absent"
expect_rc 2 "$rc"
expect_stderr "not a directory: $TMP_ROOT/absent"
end

begin "no origin/main is no verdict"
fixture no_origin
must gitc "$DIR" remote remove origin
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "no merge-base"
end

begin "an entry esbuild cannot bundle is no verdict"
fixture unbundlable
put packages/ingest/src/index.ts "export { read } from './missing';"
pin b
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "could not read the import graph of packages/ingest/src/index.ts"
end

begin "a corpus entry esbuild cannot bundle is no verdict"
fixture unbundlable_corpus
put packages/ingest/src/stored-output-fixture.ts "export { deck } from './missing';"
pin b
run_check "$DIR"
expect_rc 2 "$rc"
expect_stderr "could not read the import graph of packages/ingest/src/stored-output-fixture.ts"
end

begin "no esbuild beside the gate is no verdict"
fixture no_esbuild
must mkdir -p "$TMP_ROOT/lone/.claude/scripts"
must cp "$CHECK" "$TMP_ROOT/lone/.claude/scripts/"
put packages/ingest/src/read.ts 'export const read = (s: string): string => s;'
pin b
capture bash "$TMP_ROOT/lone/.claude/scripts/check-stored-output-pin.sh" "$DIR"
expect_rc 2 "$rc"
expect_stderr "no esbuild at $TMP_ROOT/lone/node_modules/.bin/esbuild"
end

begin "this repository passes with the shipped default root"
run_check
expect_rc 0 "$rc"
expect_stdout "check-stored-output-pin: OK — "
end

finish
