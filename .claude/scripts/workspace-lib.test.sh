#!/usr/bin/env bash
# Test harness for workspace-lib.sh, its neighbour in this directory.
#
# A driver under TMP_ROOT sources the lib, calls workspace_read on a fixture root and
# prints each pattern as `P <entry>` and each member as `M <dir>`, so a case asserts the
# whole census exactly rather than by substring. Every accepted shape and every refusal arm
# in the lib has a case; each refusal asserts exit 2 and the caller's name on stderr.
#
# Usage: bash .claude/scripts/workspace-lib.test.sh  (or `pnpm test:scripts`)
# Exit:  0 every case PASS, 1 at least one FAIL, 2 the harness itself broke.
set -uo pipefail

SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 2
LIB="$SCRIPTS/workspace-lib.sh"

# shellcheck source=./harness-lib.sh
. "$SCRIPTS/harness-lib.sh"
harness_init_tmp

DRIVER="$TMP_ROOT/driver.sh"
cat >"$DRIVER" <<EOF || exit 2
set -u
. "$LIB"
workspace_read census-driver "\$1"
rc=\$?
for p in \${WORKSPACE_PATTERNS[@]+"\${WORKSPACE_PATTERNS[@]}"}; do printf 'P %s\n' "\$p"; done
for m in \${WORKSPACE_MEMBERS[@]+"\${WORKSPACE_MEMBERS[@]}"}; do printf 'M %s\n' "\$m"; done
exit "\$rc"
EOF

FIXTURE=""

fixture() { # fixture <name>; pnpm-workspace.yaml body on stdin
  FIXTURE="$TMP_ROOT/$1"
  mkdir -p "$FIXTURE" && cat >"$FIXTURE/pnpm-workspace.yaml"
}

run_read_with() { # run_read_with <bash>
  capture "$1" "$DRIVER" "$FIXTURE"
}

expect_census() { # expect_census <exact stdout>
  [ "$out" = "$1" ] || bad "census: expected [$1], got [$out]"
}

refused() { # refused <name> <stderr substring>; pnpm-workspace.yaml body on stdin
  must fixture "$1"
  run_read_with bash
  expect_rc 2 "$rc"
  expect_stderr "census-driver: pnpm-workspace.yaml"
  expect_stderr "$2"
}

# ==========================================================================================
begin "workspace-lib.sh parses (bash -n)"
expect_parses "$LIB"
end

# The repo's own manifest, so a change to it that this reader cannot follow reds here as
# well as in every gate.
begin "the repo's own pnpm-workspace.yaml reads, and eval is a member"
FIXTURE=$(cd "$SCRIPTS/../.." && pwd -P) || exit 2
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_read_with "$interpreter"
  expect_rc 0 "$rc"
  expect_stdout "P eval"
  expect_stdout "M eval"
  expect_not_out "unbound variable"
done
case_ctx=""
end

# ==========================================================================================
# accepted shapes
# ==========================================================================================
begin "quoted, bare and commented entries read; the block ends at the next top-level key"
must fixture shapes <<'EOF'
# leading comment
packages:   # trailing comment on the key
  - 'apps/*'

  # a comment between entries
  - "packages/*"   # inline
  - eval
  - tools/gen
other:
  - 'not/a/member'
EOF
must mkdir -p "$FIXTURE/apps/web" "$FIXTURE/apps/api" "$FIXTURE/packages/shared" \
  "$FIXTURE/eval" "$FIXTURE/tools/gen" "$FIXTURE/not/a/member"
must touch "$FIXTURE/apps/README.md"
for interpreter in $BASHES; do
  case_ctx="$interpreter"
  run_read_with "$interpreter"
  expect_rc 0 "$rc"
  expect_census "P apps/*
P packages/*
P eval
P tools/gen
M apps/api
M apps/web
M packages/shared
M eval
M tools/gen"
  expect_not_out "unbound variable"
done
case_ctx=""
end

begin "a CRLF manifest reads the same as an LF one"
must fixture crlf < <(printf 'packages:\r\n  - eval\r\n')
must mkdir -p "$FIXTURE/eval"
run_read_with bash
expect_rc 0 "$rc"
expect_census "P eval
M eval"
end

# The empty tree: globs that match nothing are a census of zero members, not a refusal —
# each gate decides what an empty member list means.
begin "patterns matching no directory read as zero members, exit 0"
must fixture unmatched <<'EOF'
packages:
  - 'apps/*'
  - eval
EOF
must mkdir -p "$FIXTURE/apps"
run_read_with bash
expect_rc 0 "$rc"
expect_census "P apps/*
P eval"
end

begin "a directory two patterns name is a member once"
must fixture overlap <<'EOF'
packages:
  - 'packages/*'
  - packages/shared
EOF
must mkdir -p "$FIXTURE/packages/shared"
run_read_with bash
expect_rc 0 "$rc"
expect_census "P packages/*
P packages/shared
M packages/shared"
end

# ==========================================================================================
# refusals
# ==========================================================================================
begin "a missing pnpm-workspace.yaml exits 2"
FIXTURE="$TMP_ROOT/no_manifest"
must mkdir -p "$FIXTURE/packages/shared"
run_read_with bash
expect_rc 2 "$rc"
expect_stderr "census-driver: pnpm-workspace.yaml is missing"
end

begin "a manifest with no packages: key exits 2"
refused no_key "declares no packages: entry" <<'EOF'
minimumReleaseAge: 1440
EOF
end

begin "an empty packages: block exits 2"
refused empty_block "declares no packages: entry" <<'EOF'
packages:
minimumReleaseAge: 1440
EOF
end

begin "a flow-style packages: list exits 2"
refused flow "expected one block-style 'packages:' key" <<'EOF'
packages: ['apps/*', 'packages/*']
EOF
end

begin "a second packages: key exits 2"
refused duplicate "expected one block-style 'packages:' key" <<'EOF'
packages:
  - eval
packages:
  - 'apps/*'
EOF
end

begin "a line in the block that is not a '- ' entry exits 2"
refused mapping "not a '- <glob>' entry" <<'EOF'
packages:
  apps: '*'
EOF
end

for glob in "'!packages/legacy'" "'packages/**'" "'apps/*/*'" "'../outside'" "'.'" \
  "'apps/'" "'/abs'" "'apps//web'" "'unbalanced"; do
  begin "the packages entry $glob exits 2"
  refused "glob_$(printf '%s' "$glob" | tr -c 'A-Za-z0-9' _)" "cannot expand packages entry" <<EOF
packages:
  - $glob
EOF
  end
done

for separator in newline tab; do
  begin "a member directory named with a $separator exits 2"
  must fixture "${separator}_name" <<'EOF'
packages:
  - 'packages/*'
EOF
  if [ "$separator" = newline ]; then char=$'\n'; else char=$'\t'; fi
  must mkdir -p "$FIXTURE/packages/bad${char}name"
  run_read_with bash
  expect_rc 2 "$rc"
  expect_stderr "a directory with a tab or newline in it under packages/"
  end
done

begin "an unindented entry under packages: exits 2, naming the line"
refused unindented "line 2: packages entries must be indented under the key" <<'EOF'
packages:
- eval
EOF
end

begin "a quoted packages key exits 2, naming the line"
refused quoted_key "line 1: a quoted packages key is not read" <<'EOF'
"packages":
  - eval
EOF
end

begin "a <dir>/* glob whose directory is an executable file exits 2"
must fixture glob_file <<'EOF'
packages:
  - 'packages/*'
EOF
must touch "$FIXTURE/packages"
must chmod 755 "$FIXTURE/packages"
run_read_with bash
expect_rc 2 "$rc"
expect_stderr "names packages/*, but packages is not a directory this reader can list"
end

# The condition IS a filesystem permission, so under a root uid, where chmod restricts
# nothing, the case fails loudly rather than passing on a path it never exercised. Mode 300
# lacks read, so the glob cannot expand; mode 600 lacks search, so no entry can be stat'ed.
for mode in 300 600; do
  begin "a <dir>/* glob whose directory is mode $mode exits 2, not a census without it"
  must fixture "glob_mode_$mode" <<'EOF'
packages:
  - 'packages/*'
  - eval
EOF
  must mkdir -p "$FIXTURE/packages/store" "$FIXTURE/eval"
  must chmod "$mode" "$FIXTURE/packages"
  if [ -d "$FIXTURE/packages/store" ] && [ "$(ls "$FIXTURE/packages" 2>/dev/null)" = store ]; then
    bad "chmod $mode restricted nothing (running as root?) — the unlistable path was NOT exercised"
  else
    run_read_with bash
    expect_rc 2 "$rc"
    expect_stderr "names packages/*, but packages is not a directory this reader can list"
  fi
  must chmod 755 "$FIXTURE/packages"
  end
done

finish
