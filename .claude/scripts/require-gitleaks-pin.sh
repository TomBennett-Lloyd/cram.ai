#!/usr/bin/env bash
#
# Refuses unless the gitleaks on PATH is the pinned one (.claude/scripts/gitleaks-pin.sh, #173).
# The pre-commit hook calls it before the staged scan. A missing scanner and the wrong scanner
# are both refusals, because each would scan with rules that CI does not use.
#
# The pin is read from beside this script, never from an environment variable: a version the
# caller can redirect is not a pin, and the harness controls the pin by copying this script
# into a fixture (require-gitleaks-pin.test.sh).
#
# Usage: bash .claude/scripts/require-gitleaks-pin.sh
# Exit:  0 the pinned version is installed, 1 it is missing or a different version,
#        2 the pin could not be read.
#
# PATH is the caller's: the hook puts Homebrew on it, and the scan it then runs resolves
# gitleaks from the same PATH, so the binary judged here is the binary that scans.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
pin_file="$here/gitleaks-pin.sh"
if [ ! -r "$pin_file" ]; then
  printf 'pre-commit: cannot read the pin at %s. Restore it from git.\n' "$pin_file" >&2
  exit 2
fi
# The pin exports its values, so an inherited one would stand in for a pin that declares nothing.
unset "${!GITLEAKS_PIN_@}"
# shellcheck source=./gitleaks-pin.sh
. "$pin_file"
if [ -z "${GITLEAKS_PIN_VERSION:-}" ]; then
  printf 'pre-commit: %s declares no GITLEAKS_PIN_VERSION.\n' "$pin_file" >&2
  exit 2
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  cat >&2 <<EOF

pre-commit: gitleaks is not installed, so the commit is refused.

  Secret scanning is not optional in this repo. A leaked credential is the one
  mistake a follow-up commit cannot undo, and a scanner that skips silently looks
  the same as one that passed, so this hook fails hard instead of warning.

  Install gitleaks $GITLEAKS_PIN_VERSION, then commit again:

      brew install gitleaks      # while Homebrew resolves to the pin

EOF
  exit 1
fi

installed=$(gitleaks version 2>/dev/null)
if [ "$installed" != "$GITLEAKS_PIN_VERSION" ]; then
  cat >&2 <<EOF

pre-commit: gitleaks ${installed:-<no version reported>} is installed, but this repo pins $GITLEAKS_PIN_VERSION.

  CI scans with the pinned version, and versions differ in the rules they
  apply and the .gitleaks.toml keys they parse. A scan by any other version
  does not predict CI's result (#173).

  Either install $GITLEAKS_PIN_VERSION, or move the pin to the installed
  version in .claude/scripts/gitleaks-pin.sh as its own commit. CI follows
  the pin.

EOF
  exit 1
fi
