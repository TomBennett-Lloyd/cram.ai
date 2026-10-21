#!/usr/bin/env bash
# Test harness for require-gitleaks-pin.sh, and for the pre-commit hook's call to it (#173).
#
# Each case copies the script into a fixture directory and writes the pin it wants beside the
# copy, because the script reads its pin from its own directory. The gitleaks on PATH is a stub
# that prints whatever version a case chooses. PATH is a stub directory followed by /usr/bin:/bin,
# neither of which holds a real gitleaks on the owner's Mac or the runner.
#
# Usage: bash .claude/scripts/require-gitleaks-pin.test.sh   (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"

harness_init_tmp

# A version no gitleaks release has, so a case that reaches a real binary cannot pass by accident.
PIN=0.0.0-fixture

# fixture <name> [pin-file line...] -> DIR holding a copy of the script, its pin, and STUBS.
# No pin lines writes a pin declaring $PIN.
fixture() {
  DIR="$TMP_ROOT/$1"
  shift
  must mkdir -p "$DIR/stubs"
  must cp "$SCRIPTS/require-gitleaks-pin.sh" "$DIR/require-gitleaks-pin.sh"
  [ $# -gt 0 ] || set -- "export GITLEAKS_PIN_VERSION=$PIN"
  printf '%s\n' '# shellcheck shell=bash' "$@" >"$DIR/gitleaks-pin.sh"
}

stub_gitleaks() { # stub_gitleaks <reported version> — `gitleaks version` prints it
  printf '%s\n' '#!/bin/sh' "[ \"\$1\" = version ] && printf '%s\\n' '$1'" >"$DIR/stubs/gitleaks"
  must chmod +x "$DIR/stubs/gitleaks"
}

run_check() { # run_check [env assignments...]
  capture env PATH="$DIR/stubs:/usr/bin:/bin" "$@" bash "$DIR/require-gitleaks-pin.sh"
}

begin "the pinned version installed passes silently"
fixture match
stub_gitleaks "$PIN"
run_check
expect_rc 0
expect_silent
end

begin "a different installed version is refused, naming both"
fixture mismatch
stub_gitleaks 9.9.9
run_check
expect_rc 1
expect_stderr "gitleaks 9.9.9 is installed, but this repo pins $PIN"
end

# The comparison is exact: a version the pin is a prefix of, or one the pin extends, is another
# release.
begin "a version extending the pin, or one the pin extends, is refused"
fixture longer
stub_gitleaks "${PIN}1"
run_check
expect_rc 1
expect_stderr "this repo pins $PIN"
fixture shorter
stub_gitleaks 0.0.0
run_check
expect_rc 1
expect_stderr "gitleaks 0.0.0 is installed"
end

begin "a gitleaks that reports no version is refused"
fixture silent
stub_gitleaks ""
run_check
expect_rc 1
expect_stderr "gitleaks <no version reported> is installed"
end

begin "no gitleaks on PATH is refused, naming the pinned version to install"
fixture missing
run_check
expect_rc 1
expect_stderr "gitleaks is not installed"
expect_stderr "Install gitleaks $PIN"
end

begin "an unreadable pin is a broken check, exit 2"
fixture nopin
must rm "$DIR/gitleaks-pin.sh"
stub_gitleaks "$PIN"
run_check
expect_rc 2
expect_stderr "cannot read the pin"
end

# The inherited value is the one the stub reports, so only the unset stands between this case and
# a pass.
begin "a pin declaring nothing is exit 2, even with the version inherited from the environment"
fixture emptypin '# declares nothing'
stub_gitleaks "$PIN"
run_check GITLEAKS_PIN_VERSION="$PIN"
expect_rc 2
expect_stderr "declares no GITLEAKS_PIN_VERSION"
end

# The hook prepends Homebrew to PATH, so on the owner's Mac a real gitleaks answers here. Neither
# it nor the stub reports $PIN, so the refusal is the same on both machines.
begin "the pre-commit hook refuses before scanning when the version is not the pin"
fixture hook
stub_gitleaks 9.9.9
REPO="$DIR/repo"
must mkdir -p "$REPO/.claude/scripts"
must git -C "$REPO" init -q
must cp "$DIR/require-gitleaks-pin.sh" "$DIR/gitleaks-pin.sh" "$REPO/.claude/scripts/"
capture -C "$REPO" env PATH="$DIR/stubs:/usr/bin:/bin" bash "$SCRIPTS/../../.githooks/pre-commit"
expect_rc 1
expect_stderr "this repo pins $PIN"
expect_not_stderr "found a secret"
expect_not_stderr "node_modules is missing"
end

finish
