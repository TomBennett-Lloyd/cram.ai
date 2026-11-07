---
name: retro
description: Post-merge retrospective on how the workflow performed for a task. Produces exactly one output — a concrete workflow improvement PR, or a friction-log entry. Run after merged PRs, one retro per PR or one over several (step 0).
---

You are reviewing how the _workflow_ performed on the tasks just merged — not re-reviewing the code.

0. **Scope: one PR or several.** One retro may cover every PR merged since the last `retro:` PR (`git log --oneline origin/main | command grep -m1 'retro:'`) when none of them has a clear signal with a clear fix of its own (step 2's first arm) in a file another's fix does not touch; a PR that does gets its own retro. A combined retro reads each PR's `## Lane report` against its issue, the friction log and the last retro's body, so that nothing is logged twice, and its output is one change PR or one friction-log entry per distinct signal, a signal several PRs share being one entry that names them (`PR #565, PR #591, PR #610`). Owner observation 2026-11-07 (#659): combined retros (PRs #604, #611, #621) cost less than one per PR, and the lane report is durable in the PR body, so a retro deferred to a combined one loses nothing.

1. Reconstruct the task's history from the issue, plan comment, PR (read through `bash .claude/scripts/gh-owner-comments.sh issue|pr <n>`, `docs/standards/security.md` rule 6), and this session: plan accuracy (chunks re-planned? BLOCKED/STRUGGLING events?), review cycles used, findings that a standards trigger should have prevented, hook noise, wasted work, and any new entries in `docs/review-feedback.md` since the last retro. When the task ran delegated, read the task-orchestrator's RETRO NOTES/HANDOVER comment on the issue — the sole record of its retro observations, never the agent's chat reply — as first-hand input for this reconstruction; weigh it, don't just copy it. When it ran in the ticket-agent lane, the `## Lane report` in the PR body is that record (`.claude/agents/ticket-agent.md`).

2. Produce EXACTLY ONE of (per signal, in a combined retro):
   - **Clear signal with a clear fix** → make the change now, as its own small PR (issue label `workflow`). In order of preference:
     a. **Promote to machine enforcement**: a prose rule that keeps being violated becomes a lint rule/tsconfig flag/hook — then DELETE the prose it replaces.
     b. **Rewrite a trigger line** in CLAUDE.md's standards index — most standards misses are recognition failures, not comprehension failures; fix the trigger, not the doc.
     c. **Amend an agent/skill definition** — tighten the instruction that failed.
     d. **Encode recurring human review feedback** into the relevant standards doc or agent definition, and note the promotion in the feedback log entry.
     **A retro PR that changes a stated value, command, path or rule carries the restatement sweep** (`docs/standards/architecture.md` rule 9): the `git grep` command and its pasted output in the three parts `.claude/skills/carrier-sweep/SKILL.md` names, in the PR body, before the edit — the rule `.claude/skills/plan-issue/SKILL.md` step 4 and `.claude/agents/ticket-agent.md` § 2 state for their artefacts, stated here because a retro PR has neither. PR #96 swept for `main...HEAD` and missed `main..<branch>`, leaving two stale ranges for #52 and #97 to find (#99).
   - **No clear signal** → append ONE entry to `docs/friction-log.md` (its format). Do not force a lesson out of noise; a well-observed friction entry beats a speculative rule.

3. Prune check: scan the standards index and the rule you touched — is anything now stale, subsumed by tooling, or unused? Propose deletions. The workflow should get _smaller_ as enforcement moves into tooling, not monotonically bigger. Graduation check: if a review-feedback category has produced no new entries across several consecutive reviewed PRs/plans, propose relaxing the corresponding `.claude/workflow.json` gate — as its own PR for the user to decide.

Report: what you changed or logged, and one sentence on why.
