#!/usr/bin/env bash
#
# `pnpm models:pull`: the developer-mode generator on this Mac (#20). Installs the pinned
# Ollama, serves it on loopback, fetches the generator pin's GGUF, imports exactly that file
# and prints the gateway config. Only the generator: the encoder roles run in-process on ONNX
# Runtime in every mode (docs/adr/0003-model-roles-and-backends.md § Decision (c), (l)).
#
# The generator pin is read from PROVISIONAL_DEFAULT_PINS in packages/gateway, never restated
# here; the Ollama pin is .claude/scripts/ollama-pin.sh, resolved beside this script so the
# harness can supply its own (the install-shellcheck.sh precedent).
#
# Usage: bash .claude/scripts/models-pull.sh   (or `pnpm models:pull`)
#        CRAM_MODELS_DIR overrides where weights land (default ~/.local/share/cram/models).
# Exit:  0 the pinned GGUF is served under the printed name, 2 anything else.
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin"

die() {
  printf 'models-pull: %s\n' "$1" >&2
  shift
  [ $# -eq 0 ] || printf '%s\n' "$@" >&2
  exit 2
}
say() { printf 'models-pull: %s\n' "$*"; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
root=$(cd "$here/../.." && pwd) || exit 2

[ "$(uname -s)" = Darwin ] || die "developer mode is macOS-only; this is $(uname -s)" \
  '  The pin names only the ollama-darwin.tgz release asset.'

for tool in curl tar shasum lsof node; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed"
done
sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# Cleared before sourcing: an inherited export would otherwise stand in for a missing
# declaration (install-shellcheck.sh's reasoning on the same line).
unset "${!OLLAMA_PIN_@}"
# shellcheck source=./ollama-pin.sh
. "$here/ollama-pin.sh"
[ -n "${OLLAMA_PIN_VERSION:-}" ] && [ -n "${OLLAMA_PIN_SHA256_DARWIN:-}" ] ||
  die "$here/ollama-pin.sh declares no version or no SHA-256"

data=$HOME/.local/share/cram
# Where weights land; its other carriers are in .claude/ledgers/dev-models-directory.ledger.
models=${CRAM_MODELS_DIR:-$data/models}
# The developer-mode endpoint; its other carriers are in .claude/ledgers/dev-generator-endpoint.ledger.
port=11434
host=127.0.0.1:$port
api=http://$host/api

work=$(mktemp -d "${TMPDIR:-/tmp}/models-pull.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT INT TERM

# --- 1. Ollama --------------------------------------------------------------------------

# Staged beside its destination, so the move is a rename on one filesystem and a killed run
# leaves no half-populated directory that the presence test would accept.
bin_dir=$data/ollama-$OLLAMA_PIN_VERSION
ollama=$bin_dir/ollama
if [ ! -f "$ollama" ] || [ ! -x "$ollama" ]; then
  url="https://github.com/ollama/ollama/releases/download/v$OLLAMA_PIN_VERSION/ollama-darwin.tgz"
  say "fetching $url"
  curl -fsSL --retry 3 -o "$work/ollama.tgz" "$url" || die "download failed: $url"
  actual=$(sha256_of "$work/ollama.tgz")
  [ "$actual" = "$OLLAMA_PIN_SHA256_DARWIN" ] || die \
    'CHECKSUM MISMATCH: the downloaded Ollama is not the pinned one; nothing is installed' \
    "  expected: $OLLAMA_PIN_SHA256_DARWIN" "  actual:   $actual"
  mkdir -p "$data"
  stage=$(mktemp -d "$data/.ollama-$OLLAMA_PIN_VERSION.XXXXXX") || exit 2
  trap 'rm -rf "$work" "$stage"' EXIT INT TERM
  tar -xzf "$work/ollama.tgz" -C "$stage" || die 'could not extract the Ollama archive'
  [ -f "$stage/ollama" ] && [ -x "$stage/ollama" ] || die 'the Ollama archive holds no ollama binary'
  rm -rf "$bin_dir"
  mv "$stage" "$bin_dir" || die "cannot move Ollama into $bin_dir"
fi

# --- 2. The server, on loopback only (CLAUDE.md § Hard constraints) ---------------------

server_version() { curl -fsS --max-time 2 "$api/version" 2>/dev/null | sed -nE 's/.*"version":"([^"]*)".*/\1/p'; }

listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p') || true
if [ -n "$listeners" ]; then
  while IFS= read -r address; do
    case "$address" in
      127.*:"$port" | "[::1]:$port") ;;
      *) die "port $port is open on $address, which is not loopback" \
        '  Stop that server: developer mode serves on 127.0.0.1 only.' ;;
    esac
  done <<<"$listeners"
  say 'reusing the server already listening on loopback'
  served=$(server_version) || true
  [ "$served" = "$OLLAMA_PIN_VERSION" ] || die \
    "the server on $host reports Ollama '${served:-no version}', not the pinned $OLLAMA_PIN_VERSION" \
    '  Stop it, then re-run: this script starts the pinned one.'
else
  log=$data/ollama-serve.log
  OLLAMA_HOST=$host OLLAMA_NO_CLOUD=1 nohup "$ollama" serve >>"$log" 2>&1 &
  say "started ollama serve (pid $!, log $log)"
  for _ in $(seq 30); do
    [ -z "$(server_version)" ] || break
    sleep 1
  done
  served=$(server_version) || true
  [ "$served" = "$OLLAMA_PIN_VERSION" ] || die \
    "the server this script started reports '${served:-no version}' after 30 s, not $OLLAMA_PIN_VERSION" \
    "  Its log is $log."
fi

# --- 3. The generator's GGUF ------------------------------------------------------------

pin=$(cd "$root" && node --input-type=module -e '
import { build } from "esbuild";
const out = await build({ entryPoints: [process.argv[1]], bundle: true, platform: "node", format: "esm", write: false, logLevel: "error" });
const { PROVISIONAL_DEFAULT_PINS: { generator: g } } = await import("data:text/javascript," + encodeURIComponent(out.outputFiles[0].text));
console.log([g.artefact.repository, g.artefact.file, g.sha256].join("\n"));
' "$root/packages/gateway/src/provisional-pins.ts") || die 'cannot read the generator pin from packages/gateway'
repository=$(sed -n 1p <<<"$pin")
file=$(sed -n 2p <<<"$pin")
sha256=$(sed -n 3p <<<"$pin")
[[ $sha256 =~ ^[0-9a-f]{64}$ ]] && [ -n "$repository" ] && [ -n "$file" ] ||
  die 'the generator pin read back incomplete' "$pin"

gguf=$models/$repository/$file
if [ -f "$gguf" ] && [ "$(sha256_of "$gguf")" = "$sha256" ]; then
  say "$gguf already matches the pin"
else
  mkdir -p "$(dirname "$gguf")"
  part=$gguf.part
  if [ ! -f "$part" ] || [ "$(sha256_of "$part")" != "$sha256" ]; then
    url="https://huggingface.co/$repository/resolve/main/$file"
    say "fetching $url (resuming any partial download)"
    curl -fL --retry 3 -C - -o "$part" "$url" || die "download failed: $url"
  fi
  actual=$(sha256_of "$part")
  if [ "$actual" != "$sha256" ]; then
    rm -f "$part"
    die "CHECKSUM MISMATCH: $file is not the pinned artefact; the partial download is removed" \
      "  expected: $sha256" "  actual:   $actual"
  fi
  mv "$part" "$gguf"
  say "$gguf verified against the pin"
fi

# --- 4. Import exactly that file (ADR 0003 § Decision (c), (e)) -------------------------

# Named from the pin so a re-pin is a new model, never a silent replacement; its other
# carriers are in .claude/ledgers/dev-served-model-name.ledger.
stem=${file%.gguf}
name=$(printf '%s-%s' "$stem" "${sha256:0:12}" | tr '[:upper:]' '[:lower:]')

served_from() { OLLAMA_HOST=$host "$ollama" show --modelfile "$name" 2>/dev/null | awk '$1 == "FROM" { print $2 }'; }
served_ctx() { OLLAMA_HOST=$host "$ollama" show --modelfile "$name" 2>/dev/null | awk '$1 == "PARAMETER" && $2 == "num_ctx" { print $3 }'; }
from_pin() { case "$(served_from)" in */sha256-"$sha256") ;; *) return 1 ;; esac; }
create() { # create [num_ctx]
  printf 'FROM %s\n' "$gguf" >"$work/Modelfile"
  [ $# -eq 0 ] || printf 'PARAMETER num_ctx %s\n' "$1" >>"$work/Modelfile"
  OLLAMA_HOST=$host "$ollama" create "$name" -f "$work/Modelfile" >"$work/create.log" 2>&1 ||
    die "ollama create $name failed" "$(tail -n 5 "$work/create.log")"
}

from_pin || create
# The OpenAI-compatible API cannot set the context, so the Modelfile's is what the gateway
# gets; the artefact's own trained length means the server never trims below the model.
ctx=$(curl -fsS "$api/show" -d "{\"model\":\"$name\"}" | grep -oE '"[a-z0-9_]+\.context_length": *[0-9]+' |
  grep -oE '[0-9]+$' | head -n 1) || true
[ -n "$ctx" ] || die "cannot read the context length of $name from $api/show"
[ "$(served_ctx)" = "$ctx" ] || create "$ctx"

from_pin || die "$name is not served from blob sha256-$sha256" "  FROM: $(served_from)"
[ "$(served_ctx)" = "$ctx" ] || die "$name serves num_ctx '$(served_ctx)', not the artefact's $ctx"

say "serving $file (sha256 $sha256, num_ctx $ctx) as $name"
cat <<EOF

HttpGeneratorConfig: endpoint http://$host/v1/  servedModel $name

    export CRAM_GENERATOR_ENDPOINT=http://$host/v1/
    export CRAM_GENERATOR_MODEL=$name
EOF
