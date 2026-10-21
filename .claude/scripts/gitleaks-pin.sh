# shellcheck shell=bash
#
# The gitleaks pin: the one place the version lives. Sourced, never executed.
# Ledger: .claude/ledgers/gitleaks-pin.ledger.
#
# Both secret scans read it and neither carries a literal (#173): the pre-commit
# hook, through require-gitleaks-pin.sh, refuses any other installed version, and
# CI's `gitleaks` job hands it to gitleaks-action as GITLEAKS_VERSION. Unpinned,
# the two ran different releases, and a `.gitleaks.toml` the hook accepted would
# have failed CI.
#
# Bumping: change the number below, and nothing else. Anyone whose installed gitleaks
# differs is refused at commit time until they install it (`brew install
# gitleaks` while Homebrew resolves to the pin).

export GITLEAKS_PIN_VERSION=8.30.1
