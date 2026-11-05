---
name: ci-watch
description: Wait for a pull request's CI to go green without waiting forever - read mergeStateStatus first, because a DIRTY PR has no checks queued and a watch on it never ends. Use after gh pr create, after every push to a PR branch, and before any lane report that quotes CI.
---

Moved out of `.claude/skills/review-loop/SKILL.md` step 4's first bullet and `.claude/agents/ticket-agent.md` rule 7's parenthetical by #628. The once-only re-run of a red lane stays where it is, in review-loop step 4; this file owns the wait.

**The failure this prevents.** A `DIRTY` PR has no computable merge ref, so GitHub never queues its `pull_request` workflows, and `gh pr checks` reports "no checks reported" — indistinguishable from a queue that has not started. Four tickets polled through that state before it was diagnosed (cumulo#393, cumulo#395, cumulo#366, cumulo#398; one of them seven times over eleven minutes), and the merge owner's session of 2026-11-04 met it twice (#628). Waiting longer never clears it; a push that resolves the conflict does.

## Procedure

1. **Read mergeability, not checks.** `gh pr view <pr> --json mergeStateStatus,headRefOid > <scratchpad>/pr-<n>.json 2>&1; rc=$?; cat <scratchpad>/pr-<n>.json; echo RC=$rc`. Branch on the state:
   - `DIRTY` — stop; do not watch. A conflict only in the append-only logs is yours to clear before any report (`.claude/agents/ticket-agent.md` rule 7, rebase or merge per rule 8). Any other conflicting path waits for the `REBASE —` bounce: report PARTIAL with `CI: not run — DIRTY`, naming the conflicting paths from `git merge-tree --write-tree --name-only --no-messages origin/main HEAD` after `git fetch origin`.
   - `UNKNOWN` — GitHub is still computing; read again after a short wait, at most twice, then treat it as a mergeability problem to report, not a queue to wait out.
   - any other state (`BEHIND`, `BLOCKED`, `CLEAN`, `UNSTABLE`, `HAS_HOOKS`, `DRAFT`) — checks run on these; go to step 2. (`BEHIND` is the merge owner's `update-branch`, not yours.)
2. **Wait for the checks of this head to register.** Note `headRefOid` from step 1. `gh pr checks <pr> > <scratchpad>/checks-<n>.out 2>&1; rc=$?; tail -n 12 <scratchpad>/checks-<n>.out; echo RC=$rc`. "No checks reported" once is a queue; **twice is step 1 again, never a longer wait.** A `--watch` issued straight after a push exits green-early on the previous head's results, so it follows a read that shows checks on the new head.
3. **Watch, once, to the end.** `gh pr checks <pr> --watch > <scratchpad>/checks-<n>.out 2>&1; rc=$?; tail -n 12 <scratchpad>/checks-<n>.out; echo RC=$rc`, never through a pipe (`docs/standards/evidence.md` form 1). Run it as a background tool call and take the harness's exit notice rather than polling (evidence.md § Host conventions member 2).
4. **Re-read the head before reporting.** `gh pr view <pr> --json headRefOid`: the report's `CI:` field pastes the checks tail and this head sha, and it must equal the sha the report names as HEAD. A mismatch means a push landed after the watch started: go back to step 1.

A red is fixed under `.claude/agents/ticket-agent.md` rules 4 and 5 before any report; the one re-run allowed is review-loop step 4's. The lane never reports CI pending (rule 7).
