---
name: verify-report
description: Run the whole pnpm verify (or any long test or build command) so its output never enters the lane's context - captured to a file, exit code read at once, the verify root line checked, only a tail read. Use before every commit and wherever a lane would otherwise read a long log.
---

Moved out of `.claude/agents/ticket-agent.md` rule 4 by #628, which keeps the obligation (the whole `pnpm verify` before every commit, never a subset), the tier-1-red-by-design clause and the clean-merge exemption (a merge that rule 4 calls clean is CI-verified and skips this command); this file owns the command. The form is `docs/standards/evidence.md` form 1 and its member 1: a pipe reports its last command's status, so nothing is piped.

A log read into the lane's context is paid for again on every later turn of the lane (#624), and a passing verify has nothing in it worth reading.

## The command

```
pnpm verify > <scratchpad>/verify-<n>.out 2>&1; rc=$?
command grep -m1 '^verify root:' <scratchpad>/verify-<n>.out
tail -n 15 <scratchpad>/verify-<n>.out
echo RC=$rc
```

Capture `$?` on the line immediately after the command. Read the `verify root:` line and confirm it names this worktree before banking the exit code (a verify run from another checkout is green about the wrong tree). Report `rc=<n>` and that line, pasted; never "verify passed".

## Two lines that are not a red leg (#700)

`pnpm verify` runs inside `.claude/scripts/verify-guard.sh`, whose header owns both.

- `verify: queued` in the capture: every machine-wide slot was held, and the run waits its turn. The wait counts toward the Bash foreground limit, so a lane that might queue starts the command with `run_in_background: true` and reads the exit code from the file.
- `verify: tree changed during the run — result void` beside a non-zero `rc`: the run belongs to no single tree. Re-run it with the tree held still; do not triage a leg from it.

## When it is red

1. Name the failing leg from the tail. If the tail does not show it, count first: `n=$(command grep -cE '(FAIL|Error|error TS)' <scratchpad>/verify-<n>.out)` and read at most `command grep -nE '(FAIL|Error|error TS)' <scratchpad>/verify-<n>.out | head -n 20`. The words locate the failure; the exit code is still the verdict (evidence.md form 6).
2. A failure whose cause is not clear from those twenty lines is a read-only task whose only product is a conclusion: dispatch one fresh `general-purpose` agent on Sonnet (`.claude/agents/ticket-agent.md` rule 3(f)) with the path of the log and the question "which test or leg failed first, with what message, and which file and line does it name?". It returns that and the command output that evidences it, not the log.
3. A tier-1 red that rule 4 declares is read from the same file the same way; the commit body line rule 4 requires is yours to write.

## A targeted test while iterating

`pnpm --filter <pkg> exec vitest run <patterns> > <scratchpad>/test-<n>.out 2>&1; rc=$?; tail -n 10 <scratchpad>/test-<n>.out; echo RC=$rc` is the same shape. A one-line result needs no file.
