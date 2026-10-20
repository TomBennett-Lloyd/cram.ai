# shellcheck shell=bash
#
# THE OLLAMA PIN, the developer-mode generator server (docs/adr/0003-model-roles-and-backends.md
# § Decision (c)). Sourced by models-pull.sh, never executed. A10 is checked against this
# version's docs/api/openai-compatibility.mdx (#20).
#
# BUMPING: take the `ollama-darwin.tgz` line of the release's `sha256sum.txt`
# (https://github.com/ollama/ollama/releases), confirm `shasum -a 256` of the downloaded asset
# agrees, update both values together, re-run `pnpm models:pull`, and re-check A10.

export OLLAMA_PIN_VERSION=0.40.6
export OLLAMA_PIN_SHA256_DARWIN=b2b55434865a668decb494110d7fd970eed3ecc8837be2872f672ccbb95df974
