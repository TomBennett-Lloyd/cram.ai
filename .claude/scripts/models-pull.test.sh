#!/usr/bin/env bash
# Test harness for .claude/scripts/models-pull.sh (#20).
#
# Offline: `uname`, `curl`, `lsof` and `node` are stubs at the front of PATH, and the
# "Ollama" the script installs is a stub packed into a fixture archive, so every checksum is
# computed over real bytes and nothing reaches the network or loads a model.
#
# Usage: bash .claude/scripts/models-pull.test.sh   (or `pnpm test:scripts`)
#        MODELS_PULL_SCRIPT=<copy> runs the cases against a mutant (docs/standards/testing.md rule 8),
#        and GENERATOR_PIN_SCRIPT=<copy> does the same for generator-pin.mjs.
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail
export PATH="$PATH:/opt/homebrew/bin"

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
SUBJECT=${MODELS_PULL_SCRIPT:-$SCRIPTS/models-pull.sh}
PIN_READER=${GENERATOR_PIN_SCRIPT:-$SCRIPTS/generator-pin.mjs}
harness_init_tmp

FIXTURE_VERSION=1.2.3
ZEROES=0000000000000000000000000000000000000000000000000000000000000000
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# --- stubs, shared by every case ---------------------------------------------------------

STUBS="$TMP_ROOT/stubs"
must mkdir -p "$STUBS/bin" "$STUBS/pack"

cat >"$STUBS/bin/uname" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${STUB_OS:-Darwin}"
EOF
cat >"$STUBS/bin/lsof" <<'EOF'
#!/usr/bin/env bash
[ -n "${STUB_LSOF:-}" ] || exit 1
printf 'p1\nf4\n'
printf '%s\n' "$STUB_LSOF" | sed 's/^/n/'
EOF
cat >"$STUBS/bin/node" <<'EOF'
#!/usr/bin/env bash
[ -z "${STUB_NODE_FAIL:-}" ] || exit 1
printf '%s\n' "$STUB_PIN"
EOF
# The script's 1 s server poll, shortened so the never-answers case stays fast.
cat >"$STUBS/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exec /bin/sleep 0.1
EOF
# The server: up once the stub `ollama serve` has run, or when a case says one is listening.
# `-C -` resumes as curl does, appending the source from the destination's current size.
cat >"$STUBS/bin/curl" <<'EOF'
#!/usr/bin/env bash
out="" url="" data="" resume=""
fetch() {
  if [ -n "$resume" ] && [ -f "$out" ]; then
    tail -c +"$(($(wc -c <"$out") + 1))" "$1" >>"$out"
  else
    cp "$1" "$out"
  fi
}
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -d) data=$2; shift 2 ;;
    -C) resume=$2; shift 2 ;;
    --max-time | --retry) shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >>"$STUB_STATE/curl.log"
case "$url" in
  */ollama-darwin.tgz) [ "${STUB_FETCH_FAIL:-}" != ollama ] || exit 22; fetch "$STUB_TGZ" ;;
  https://huggingface.co/*) [ "${STUB_FETCH_FAIL:-}" != gguf ] || exit 22; fetch "$STUB_GGUF" ;;
  */api/version)
    [ -f "$STUB_STATE/up" ] || exit 7
    [ "${STUB_SERVER_VERSION-x}" != "" ] || exit 22
    printf '{"version":"%s"}' "${STUB_SERVER_VERSION:-$STUB_PIN_VERSION}" ;;
  */api/show)
    model=$(printf '%s' "$data" | sed -nE 's/.*"model":"([^"]*)".*/\1/p')
    [ -f "$STUB_STATE/model-$model" ] || exit 22
    printf '{"model_info":{"general.parameter_count":4022468096%s}}' \
      "${STUB_CTX:+,\"qwen3.context_length\":$STUB_CTX}" ;;
  *) printf 'curl stub: unexpected %s\n' "$url" >&2; exit 2 ;;
esac
EOF
# The Ollama the archive delivers. `create` records the blob as the FROM file's digest, as
# the real one does, unless STUB_FROM replaces the path it reports.
cat >"$STUBS/pack/ollama" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  serve)
    printf 'OLLAMA_HOST=%s OLLAMA_NO_CLOUD=%s\n' "${OLLAMA_HOST:-}" "${OLLAMA_NO_CLOUD:-}" >"$STUB_STATE/serve.env"
    [ -n "${STUB_SERVE_SILENT:-}" ] || touch "$STUB_STATE/up" ;;
  create)
    [ -z "${STUB_CREATE_FAIL:-}" ] || { printf 'Error: stub create failed\n' >&2; exit 1; }
    from=$(awk '$1 == "FROM" { print $2 }' "$4")
    printf 'FROM %s\n' "${STUB_FROM:-/blobs/sha256-$(shasum -a 256 "$from" | awk '{print $1}')}" >"$STUB_STATE/model-$2"
    [ -n "${STUB_DROP_CTX:-}" ] || grep '^PARAMETER' "$4" >>"$STUB_STATE/model-$2"
    printf '%s\n' "$2" >>"$STUB_STATE/create.log" ;;
  show) cat "$STUB_STATE/model-$3" 2>/dev/null || exit 1 ;;
esac
EOF
must chmod +x "$STUBS/bin/"* "$STUBS/pack/ollama"
must tar -czf "$STUBS/ollama-darwin.tgz" -C "$STUBS/pack" ollama
TGZ_SUM=$(sha_of "$STUBS/ollama-darwin.tgz")
printf 'synthetic weights\n' >"$STUBS/weights.gguf"
GGUF_SUM=$(sha_of "$STUBS/weights.gguf")
SERVED=fixture-q4_k_m-${GGUF_SUM:0:12}
# What the stub `node` reports as PROVISIONAL_GENERATOR_CONTEXT_LENGTH, equal to the stub
# artefact's trained length (STUB_CTX) unless a case says otherwise.
PIN_CTX=4096
pin_of() { printf '%s\n' Org/Fixture-GGUF Fixture-Q4_K_M.gguf "$1" "${2-$PIN_CTX}"; } # pin_of <sha256> [ctx]

# --- fixtures ----------------------------------------------------------------------------

# fixture <name> [ollama sha] -> DIR, a repo-shaped copy of the subject with its own pin and
# its own HOME, and a stub state directory.
fixture() {
  DIR="$TMP_ROOT/$1"
  must mkdir -p "$DIR/.claude/scripts" "$DIR/home" "$DIR/state"
  must cp "$SUBJECT" "$DIR/.claude/scripts/models-pull.sh"
  printf '%s\n' '# shellcheck shell=bash' "export OLLAMA_PIN_VERSION=$FIXTURE_VERSION" \
    "export OLLAMA_PIN_SHA256_DARWIN=${2:-$TGZ_SUM}" >"$DIR/.claude/scripts/ollama-pin.sh"
  GGUF="$DIR/home/.local/share/cram/models/Org/Fixture-GGUF/Fixture-Q4_K_M.gguf"
}

run() { # run [VAR=value]... — the pin lines default to the fixture GGUF's
  capture env PATH="$STUBS/bin:$PATH" HOME="$DIR/home" STUB_STATE="$DIR/state" \
    STUB_TGZ="$STUBS/ollama-darwin.tgz" STUB_GGUF="$STUBS/weights.gguf" STUB_CTX=4096 \
    STUB_PIN_VERSION="$FIXTURE_VERSION" STUB_PIN="$(pin_of "$GGUF_SUM")" \
    "$@" bash "$DIR/.claude/scripts/models-pull.sh"
}

count() { # count <file> <pattern> — matching lines, 0 for an absent file
  local n=0
  [ ! -f "$1" ] || n=$(grep -c -- "$2" "$1")
  printf '%s\n' "$n"
}

# ===========================================================================================

begin "a platform other than macOS is refused before anything is fetched"
fixture linux
run STUB_OS=Linux
expect_rc 2
expect_stderr "macOS-only"
[ ! -f "$DIR/state/curl.log" ] || bad "fetched on a refused platform"
end

begin "from nothing: installs the pin, serves on loopback with cloud off, imports the GGUF with its context"
fixture fresh
run
expect_rc 0
expect_stdout "servedModel $SERVED"
expect_stdout "export CRAM_GENERATOR_MODEL=$SERVED"
expect_stdout "export CRAM_GENERATOR_ENDPOINT=http://127.0.0.1:11434/v1/"
[ "$(count "$DIR/state/curl.log" ollama-darwin.tgz)" = 1 ] || bad "Ollama not fetched once"
[ "$(count "$DIR/state/curl.log" huggingface.co/Org/Fixture-GGUF/resolve/main/Fixture-Q4_K_M.gguf)" = 1 ] ||
  bad "GGUF not fetched once from the pin's repository and file"
holds() { grep -qF -- "$2" "$1" 2>/dev/null || bad "$1 lacks '$2'"; }
holds "$DIR/state/serve.env" "OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1"
holds "$DIR/state/model-$SERVED" "FROM /blobs/sha256-$GGUF_SUM"
holds "$DIR/state/model-$SERVED" "PARAMETER num_ctx 4096"
[ -f "$GGUF" ] && [ ! -e "$GGUF.part" ] || bad "the verified GGUF is not in place"
end

begin "a second run fetches nothing and creates nothing"
creates=$(count "$DIR/state/create.log" .)
run STUB_LSOF=127.0.0.1:11434
expect_rc 0
expect_stdout "already matches the pin"
expect_stdout "reusing the server"
[ "$(count "$DIR/state/curl.log" '^https')" = 2 ] || bad "a second run fetched"
[ "$(count "$DIR/state/create.log" .)" = "$creates" ] || bad "a second run re-created the model"
end

begin "a complete .part matching the pin is adopted without a fetch"
fixture part
must mkdir -p "$(dirname "$GGUF")"
must cp "$STUBS/weights.gguf" "$GGUF.part"
run
expect_rc 0
[ "$(count "$DIR/state/curl.log" huggingface)" = 0 ] || bad "fetched over a matching .part"
[ -f "$GGUF" ] || bad "the .part was not moved into place"
end

begin "pin declarations come from the pin file, never the environment"
fixture empty_pin
printf '%s\n' '# shellcheck shell=bash' >"$DIR/.claude/scripts/ollama-pin.sh"
expect_refused() {
  expect_rc 2
  expect_stderr "declares no version or no SHA-256"
}
case_ctx="a clean environment"
run
expect_refused
case_ctx="both inherited"
run OLLAMA_PIN_VERSION="$FIXTURE_VERSION" OLLAMA_PIN_SHA256_DARWIN="$TGZ_SUM"
expect_refused
case_ctx="a pin declaring only the version"
printf '%s\n' "export OLLAMA_PIN_VERSION=$FIXTURE_VERSION" >"$DIR/.claude/scripts/ollama-pin.sh"
run
expect_refused
case_ctx="a pin declaring only the SHA-256"
printf '%s\n' "export OLLAMA_PIN_SHA256_DARWIN=$TGZ_SUM" >"$DIR/.claude/scripts/ollama-pin.sh"
run
expect_refused
case_ctx=""
end

begin "a pinned archive holding no ollama binary is not installed"
for holds in README directory unexecutable; do
  fixture "archive_$holds"
  must mkdir -p "$DIR/pack"
  case "$holds" in
    README) must touch "$DIR/pack/README" ;;
    directory) must mkdir "$DIR/pack/ollama" ;;
    unexecutable) must touch "$DIR/pack/ollama" ;;
  esac
  must tar -czf "$DIR/archive.tgz" -C "$DIR/pack" .
  fixture "archive_$holds" "$(sha_of "$DIR/archive.tgz")"
  case_ctx="an archive holding $holds"
  run STUB_TGZ="$DIR/archive.tgz"
  expect_rc 2
  expect_stderr "holds no ollama binary"
  [ ! -e "$DIR/home/.local/share/cram/ollama-$FIXTURE_VERSION" ] || bad "installed anyway"
done
case_ctx=""
end

begin "a failed download is refused by name"
for what in ollama gguf; do
  fixture "fetch_fail_$what"
  case_ctx="$what"
  run STUB_FETCH_FAIL="$what"
  expect_rc 2
  expect_stderr "download failed: https://"
done
case_ctx=""
end

begin "a pinned archive that does not extract is refused"
fixture not_gzip
printf 'not a tarball\n' >"$DIR/plain.tgz"
printf '%s\n' '# shellcheck shell=bash' "export OLLAMA_PIN_VERSION=$FIXTURE_VERSION" \
  "export OLLAMA_PIN_SHA256_DARWIN=$(sha_of "$DIR/plain.tgz")" >"$DIR/.claude/scripts/ollama-pin.sh"
run STUB_TGZ="$DIR/plain.tgz"
expect_rc 2
expect_stderr "could not extract the Ollama archive"
end

begin "a generator pin that cannot be read is refused"
fixture node_fail
run STUB_NODE_FAIL=1
expect_rc 2
expect_stderr "cannot read the generator pin"
end

begin "a failed import is refused with Ollama's own error"
fixture create_fail
run STUB_CREATE_FAIL=1
expect_rc 2
expect_stderr "ollama create $SERVED failed"
expect_stderr "stub create failed"
end

begin "a GGUF on disk that does not match the pin is fetched again"
fixture stale
must mkdir -p "$(dirname "$GGUF")"
printf 'stale\n' >"$GGUF"
run
expect_rc 0
[ "$(count "$DIR/state/curl.log" huggingface)" = 1 ] || bad "not fetched again"
[ "$(sha_of "$GGUF")" = "$GGUF_SUM" ] || bad "the stale file is still in place"
end

begin "a .part that is a prefix of the pinned file is resumed"
fixture prefix_part
must mkdir -p "$(dirname "$GGUF")"
head -c 7 "$STUBS/weights.gguf" >"$GGUF.part" || exit 2
run
expect_rc 0
[ "$(count "$DIR/state/curl.log" huggingface)" = 1 ] || bad "not fetched once"
[ "$(sha_of "$GGUF")" = "$GGUF_SUM" ] && [ ! -e "$GGUF.part" ] || bad "the resumed file is not in place"
end

begin "a corrupt .part fails the checksum, is removed, and the next run starts afresh"
fixture corrupt_part
must mkdir -p "$(dirname "$GGUF")"
printf 'stale\n' >"$GGUF.part"
run
expect_rc 2
expect_stderr "CHECKSUM MISMATCH: Fixture-Q4_K_M.gguf"
[ ! -e "$GGUF.part" ] || bad "the corrupt .part was kept"
run
expect_rc 0
[ "$(sha_of "$GGUF")" = "$GGUF_SUM" ] || bad "the second run did not fetch afresh"
end

begin "CRAM_MODELS_DIR moves where the weights land"
fixture models_dir
run CRAM_MODELS_DIR="$DIR/elsewhere"
expect_rc 0
[ -f "$DIR/elsewhere/Org/Fixture-GGUF/Fixture-Q4_K_M.gguf" ] && [ ! -e "$GGUF" ] ||
  bad "the GGUF is not under CRAM_MODELS_DIR"
end

begin "an install directory without an executable ollama file is installed over"
for holds in directory unexecutable; do
  fixture "hollow_$holds"
  bin="$DIR/home/.local/share/cram/ollama-$FIXTURE_VERSION"
  must mkdir -p "$bin"
  case "$holds" in
    directory) must mkdir "$bin/ollama" ;;
    unexecutable) must touch "$bin/ollama" ;;
  esac
  case_ctx="an install holding $holds"
  run
  expect_rc 0
  [ "$(count "$DIR/state/curl.log" ollama-darwin.tgz)" = 1 ] || bad "not installed"
  [ -f "$bin/ollama" ] && [ -x "$bin/ollama" ] || bad "no ollama binary in place"
done
case_ctx=""
end

begin "a server this script started that never answers is reported with its log"
fixture silent_server
run STUB_SERVE_SILENT=1
expect_rc 2
expect_stderr "the server this script started reports 'no version'"
expect_stderr "Its log is $DIR/home/.local/share/cram/ollama-serve.log"
end

begin "an Ollama archive that is not the pinned one is not installed"
fixture bad_tgz "$ZEROES"
run
expect_rc 2
expect_stderr "CHECKSUM MISMATCH: the downloaded Ollama"
[ ! -e "$DIR/home/.local/share/cram/ollama-$FIXTURE_VERSION" ] || bad "installed anyway"
end

begin "a GGUF that is not the pinned artefact is removed and never imported"
fixture bad_gguf
run STUB_PIN="$(pin_of "$ZEROES")"
expect_rc 2
expect_stderr "CHECKSUM MISMATCH: Fixture-Q4_K_M.gguf"
[ ! -e "$GGUF" ] && [ ! -e "$GGUF.part" ] || bad "a mismatched GGUF was kept"
[ ! -f "$DIR/state/create.log" ] || bad "a mismatched GGUF was imported"
end

begin "a generator pin that reads back incomplete is refused"
fixture short_pin
upper=$(printf '%s' "$GGUF_SUM" | tr 'a-f' 'A-F')
for pin in "$(printf '%s\n' Org/Fixture-GGUF Fixture-Q4_K_M.gguf '' "$PIN_CTX")" \
  "$(pin_of "${GGUF_SUM:1}")" "$(pin_of "${GGUF_SUM}0")" "$(pin_of "X$GGUF_SUM")" "$(pin_of "$upper")" \
  "$(printf '%s\n' '' Fixture-Q4_K_M.gguf "$GGUF_SUM" "$PIN_CTX")" \
  "$(printf '%s\n' Org/Fixture-GGUF '' "$GGUF_SUM" "$PIN_CTX")" \
  "$(pin_of "$GGUF_SUM" '')" "$(pin_of "$GGUF_SUM" 0)" "$(pin_of "$GGUF_SUM" 04096)" \
  "$(pin_of "$GGUF_SUM" 4096x)" "$(pin_of "$GGUF_SUM" x4096)" "$(pin_of "$GGUF_SUM" -4096)" \
  "$(printf '%s\n' Org/Fixture-GGUF Fixture-Q4_K_M.gguf "$GGUF_SUM")"; do
  case_ctx="pin $(printf '%s' "$pin" | tr '\n' '|')"
  run STUB_PIN="$pin"
  expect_rc 2
  expect_stderr "read back incomplete"
done
case_ctx=""
end

begin "a listener on port 11434 at a non-loopback address is refused"
fixture public
for listener in '*:11434' '0.0.0.0:11434' '192.168.1.10:11434' '[::]:11434' \
  "$(printf '127.0.0.1:11434\n*:11434')"; do
  case_ctx="$listener"
  run STUB_LSOF="$listener"
  expect_rc 2
  expect_stderr "which is not loopback"
done
case_ctx=""
end

begin "a pinned server already on loopback is reused, not restarted"
for listener in '127.0.0.1:11434' '127.0.0.2:11434' '[::1]:11434'; do
  fixture "loopback$(printf '%s' "$listener" | tr -c 'a-z0-9' _)"
  touch "$DIR/state/up"
  case_ctx="$listener"
  run STUB_LSOF="$listener"
  expect_rc 0
  expect_stdout "reusing the server already listening on loopback"
  [ ! -f "$DIR/state/serve.env" ] || bad "started a second server"
done
case_ctx=""
end

begin "a loopback server that is not the pinned Ollama is refused"
for reported in 9.9.9 ''; do
  fixture "wrong_server_${reported:-none}"
  touch "$DIR/state/up"
  case_ctx="version '${reported}'"
  run STUB_LSOF=127.0.0.1:11434 STUB_SERVER_VERSION="$reported"
  expect_rc 2
  expect_stderr "not the pinned $FIXTURE_VERSION"
  [ ! -f "$DIR/state/create.log" ] || bad "imported into the wrong server"
done
case_ctx=""
end

begin "a model served from any blob but the pin's is refused"
n=0
for from in "/blobs/sha256-$ZEROES" "/blobs/sha256-${GGUF_SUM}0" "/blobs/xsha256-$GGUF_SUM"; do
  n=$((n + 1))
  fixture "wrong_blob_$n"
  case_ctx="FROM $from"
  run STUB_FROM="$from"
  expect_rc 2
  expect_stderr "is not served from blob sha256-$GGUF_SUM"
done
case_ctx=""
end

begin "an unreadable context length is refused"
fixture no_ctx
run STUB_CTX=
expect_rc 2
expect_stderr "cannot read the context length"
end

begin "a num_ctx that did not land is refused"
fixture dropped_ctx
run STUB_DROP_CTX=1
expect_rc 2
expect_stderr "serves num_ctx '', not PROVISIONAL_GENERATOR_CONTEXT_LENGTH's 4096"
end

begin "generator-pin.mjs reads the pin and the context length from the module's exports"
# The real reader, with the real node and esbuild, over a module whose values no other file holds:
# a value the reader restated would print instead of the module's.
must mkdir -p "$TMP_ROOT/pin_module"
printf '%s\n' \
  "export const PROVISIONAL_DEFAULT_PINS = { generator: { artefact: { repository: 'Org/Read-GGUF', file: 'Read-Q4.gguf' }, sha256: '$GGUF_SUM' } };" \
  'export const PROVISIONAL_GENERATOR_CONTEXT_LENGTH = 12345;' >"$TMP_ROOT/pin_module/provisional-pins.ts"
capture node "$PIN_READER" "$TMP_ROOT/pin_module/provisional-pins.ts"
expect_rc 0
[ "$out" = "$(printf '%s\n' Org/Read-GGUF Read-Q4.gguf "$GGUF_SUM" 12345)" ] || bad "read back: $out"
end

begin "the context length served is PROVISIONAL_GENERATOR_CONTEXT_LENGTH, not the artefact's trained one"
fixture short_ctx
run STUB_PIN="$(pin_of "$GGUF_SUM" 2048)"
expect_rc 0
expect_stdout "num_ctx 2048"
holds "$DIR/state/model-$SERVED" "PARAMETER num_ctx 2048"
end

begin "a PROVISIONAL_GENERATOR_CONTEXT_LENGTH the artefact was not trained to is refused, never served"
fixture long_ctx
run STUB_PIN="$(pin_of "$GGUF_SUM" 4097)"
expect_rc 2
expect_stderr "PROVISIONAL_GENERATOR_CONTEXT_LENGTH 4097 is above the 4096 Fixture-Q4_K_M.gguf was trained to"
! grep -q 'num_ctx' "$DIR/state/model-$SERVED" 2>/dev/null || bad "a num_ctx was served anyway"
end

begin "a changed PROVISIONAL_GENERATOR_CONTEXT_LENGTH re-creates the served model"
fixture moved_ctx
run
expect_rc 0
creates=$(count "$DIR/state/create.log" .)
run STUB_LSOF=127.0.0.1:11434 STUB_PIN="$(pin_of "$GGUF_SUM" 2048)"
expect_rc 0
[ "$(count "$DIR/state/create.log" .)" -gt "$creates" ] || bad "the model was not re-created"
holds "$DIR/state/model-$SERVED" "PARAMETER num_ctx 2048"
end

finish
