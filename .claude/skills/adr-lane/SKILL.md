---
name: adr-lane
description: What a ticket-agent lane does when its issue carries the adr label - the planner dispatch, the PROCEED and REVISE bounces, the approved-at-plan classification and fill, and the ADR amendment arms. Use when the issue has an adr label, a PROCEED or REVISE arrives, or the PR's humanAlways paths are all ADRs.
---

Moved out of `.claude/agents/ticket-agent.md` rules 2, 3(e) and 7 by #669, which keeps each trigger sentence; this file owns the procedure. The moved text is verbatim except that locators which were relative to those rules ("the next paragraph", "the HUMAN order above") now name their section or rule. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; bare `#<n>` is this repo's.

## 1. Planning an `adr` issue

**(e) `planner`** for an `adr` issue's plan, on Fable (`conserve` → Opus, noted in the plan comment), whose plan — the file its first line names (`.claude/agents/planner.md`) — you post as rule 2's plan comment, under `.claude/agents/ticket-agent.md` rule 2's heading: the proposal the owner accepted on 2026-10-16 (#49) kept ADR planning on Fable and moved only execution and review inline.

## 2. The owner's answer

`PROCEED — <the owner's words, verbatim>` → execute per `.claude/agents/ticket-agent.md` rules 3–8, unchanged; every `REVISE` before it lands as a `plan` entry in `docs/review-feedback.md` in your first commit. Your first plan-comment edit after it quotes the `PROCEED` verbatim, with its date, at the comment's head; from then on the comment's Decision outline and files are what the owner approved, and later edits only tick steps or add `Footprint change:` lines, so the comment's edit history shows the approved state. When the plan touches a `humanAlways` path, section 3 below decides whether the pre-label `docs/review-feedback.md` entry, the label order and the merge owner's verdict-fill bounce (yours to commit) apply.

`REVISE — <feedback>` → revise the plan comment (fetch-modify-push) and return BLOCKED again.

## 3. Approved at plan

**Approved at plan.** A PR closing an `adr` issue that resumed on a `PROCEED` is judged against `.claude/workflow.json` → `merge.approvedAtPlanRule`, which owns the evidence and what counts as an extra. Its body pastes the Decision mapping, one line per point (`plan (<x>) → ADR § Decision (<y>)`), until both lists are exhausted, and the report fills `Extras beyond the approved plan:`. `none` → the pre-label entry, its Feedback quoting the `PROCEED` and linking the plan comment, then the PR, then `bash .claude/scripts/fill-verdict.sh <pr> --category approved-at-plan --verdict "approved at plan <date> — <the PROCEED's words>" --worktree <your worktree>`, run bare per `.claude/agents/ticket-agent.md` rule 8, all before the report, and no label. On an amendment footprint that fill is refused unless the entry also passes `merge.amendmentRule` (a), which section 4 below states. Anything listed → the HUMAN order (`.claude/agents/ticket-agent.md` rule 7: the entry first, then the label), with the entry's Feedback and the report's review guide limited to the extras. An extra arriving after the fill — a `FIX`, a rebase true-up — returns the entry to both placeholders and the ADR's Status to `proposed` in the commit that brings it, then takes the HUMAN order.

## 4. An ADR amendment

**An ADR amendment.** A PR whose every `humanAlways` path is an existing ADR edited in place takes `.claude/workflow.json` → `merge.amendmentRule`, which owns both tests. Arm (a): the plan comment pastes the amendment before your first edit to the ADR — its diff, or the entry text when the entry is the whole change — and the entry is filled `approved-at-plan`, its Verdict citing that comment's URL. Arm (b): the inline change is only a path this PR moves, and the entry is filled `path-move-amendment`. `.claude/agents/ticket-agent.md` rule 6's review is owed even when the diff holds no source. Before the fill, run the check `merge-pr.sh` will run, `.claude/scripts/adr-amendment-check.mjs` (its header gives the modes), on the PR's diff; a refusal takes the HUMAN order instead. `Classification:` names the arm.
