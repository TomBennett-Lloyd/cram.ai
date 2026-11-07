---
name: merge-owner-start
description: How a fresh session becomes the merge owner - reconcile from GitHub (open PRs, planned and adr issues, plan comments and what follows them), resume parked plans, run the owed checks, retros and tally, and the standing rules the role carries. Use when the start prompt says you are the merge owner.
---

The start prompt is two lines: you are the merge owner of cram.ai; run `merge-owner-start`. Anything else in a prompt is the owner's task for this session, not state to rebuild. Written from the first session that started this way, whose log is [#659's comment](https://github.com/TomBennett-Lloyd/cram.ai/issues/659#issuecomment-6704599936): that session spent its cost locating state, not deciding what to do, so this file is the locating.

**Where state lives.** Issues and PRs are the record: plan comments, lane reports in PR bodies, the owner's `PROCEED` or `REVISE` lines, the tally on #624. Memory is a pointer to them and holds the current state in about fifteen lines (main's short sha, open PRs, parked plans by number, owed items); a handover moves history out of it, to the issue or PR that already records it, because memory loads whole every session. Re-derive state from GitHub rather than trusting a snapshot. The lane and merge procedure is `.claude/skills/run-issue/SKILL.md`, which this file does not restate.

## 1. Reconcile

One parallel batch, from the main checkout (`/Users/tom/Documents/Repos/cram.ai`, parked on `main`):

```
git fetch origin && git log --oneline -5 origin/main
sysctl -n vm.loadavg; sysctl -n hw.ncpu; cat ~/.local/state/claude-budget/mode
gh pr list --state open --json number,title,headRefName,labels,isDraft,mergeStateStatus
gh issue list --state open --label planned --json number,title
gh issue list --state open --label adr --json number,title
```

- **The load gate's line is computed:** twice `hw.ncpu`, against the middle (5-minute) figure of `vm.loadavg` (`run-issue` step 1). A missing budget-mode file means `normal`.
- **A lane still running** is a worktree not yet reaped: `git worktree list` (merged lanes are removed, `--no-merged` is useless here because a squash leaves every branch looking unmerged), with `gh pr list --head <branch>` for its PR. Start the in-flight table from those, one row each (`run-issue` step 1).
- **An open PR** is read per `run-issue` steps 4 and 5: ready, `awaiting-review` for the owner, or `DIRTY`/`BEHIND` and waiting its turn.

## 2. Read the parked plans

A planned issue's state is **its plan comment and everything after it**, not its newest comments: a plan over GitHub's 65k-character comment limit puts its sweep output in a sibling comment, and a lane's `BLOCKED` report, the owner's `PROCEED` and a resume addendum all follow it. For issue `<n>`:

```
gh issue view <n> --json comments --jq '.comments | (map(.body | startswith("## Plan (ticket-agent lane)")) | index(true)) as $i | to_entries | map(select(.key >= $i)) | .[] | "\(.key)\t\(.value.createdAt)\t\(.value.body | length)\t\(.value.body[0:70] | gsub("\n";" "))"'
```

That prints an index, time, length and first line per comment from the plan on; read bodies with `gh issue view <n> --json comments --jq '.comments[<key>].body'`. Plan comments run to tens of thousands of characters, so give the read to one read-only agent (`Explore`) per set of issues, asking for each plan's footprint, its `Depends on` lines, its open questions and what the owner has answered since, and keep the summary. A plan is **parked** when its last comment is a lane `BLOCKED — owner decision` report with no owner answer after it.

## 3. Resume

- **An answered plan** resumes as `RESUME issue #<n>` followed by the owner's line verbatim (`PROCEED — <words>` or `REVISE — <feedback>`, `.claude/agents/ticket-agent.md` rule 2), with the four dispatch fields of `run-issue` step 2. Post the owner's words on the issue first, so the record outlives your session.
- **A plan older than main.** The overlap note pastes `git log --oneline <the sha the plan's sweep names>..origin/main -- <the plan's files>`. A non-empty output tells the lane the plan's counts predate those commits and its sweep is re-run before the first edit (`.claude/skills/carrier-sweep/SKILL.md`); the lane decides what moved.
- **Plans that share a file** the append-only logs do not cover, such as the tail of one ADR's Amendments, release one at a time, in `run-issue` step 4's **Merge order**; the second to merge takes a `REBASE —` bounce, and each plan's footprint says so before you dispatch.
- **A plan with no answer** stays parked. Do not ask the owner again for what an issue comment already records.

## 4. Owed checks, retros and the tally

- **Retros.** Find the last `retro:` PR (`git log --oneline origin/main | command grep -m1 'retro:'`); the lane PRs merged after it are owed one retro, combined per `.claude/skills/retro/SKILL.md`. A retro that changes a file is a PR, so dispatch it as an Agent call with `isolation: "worktree"`, which gives it its own worktree. Triage is owed by its own skill's count.
- **Tally.** #624's routing experiment and #628's fan-out rule are measured per lane, on #624, one comment per merged lane, starting with the lane that ran #659. At release (`run-issue` step 6) read the lane's transcript, `~/.claude/projects/<project>/<session>/subagents/agent-<agentId>.jsonl` (the launch result names the `agentId`; the Agent tool's `output_file` is a task log, do not read it whole), and post
  `Lane row: #<n> PR #<m> <opus|sonnet> turns <t> first-turn <k> effective <e> FIX <b> CI-reds <r>`:

  ```
  jq -s '[.[] | select(.type == "assistant") | .message] as $all
    | ($all | unique_by(.id)) as $t | $all[0].usage as $f
    | {model: $all[0].model, turns: ($t | length),
       first_turn: ($f.input_tokens + $f.cache_read_input_tokens + $f.cache_creation_input_tokens),
       effective: ($t | map(.usage | .input_tokens + 0.1 * .cache_read_input_tokens + 2 * .cache_creation_input_tokens + 5 * .output_tokens) | add | round)}' <transcript>
  ```

  Each assistant message appears once per content block, so the filter deduplicates on `message.id`; `effective` weights input 1, cache read 0.1, cache write 2 and output 5, the weighting #624 used. The count is the comments that start `Lane row:`:
  `gh issue view 624 --json comments --jq '[.comments[].body | select(startswith("Lane row:"))] | {total: length, sonnet: map(select(test(" sonnet "))) | length, opus: map(select(test(" opus "))) | length}'`.
  At ten rows of each model, post the comparison table on #624 and put the policy decision to the owner (`CLAUDE.md` is on the list of paths `.claude/workflow.json` holds for the owner's review). #628's re-run is ten rows of any model with no lane above 20M effective without a named cause, and #624's acceptance re-runs the medians after twenty.

- **#656's first-turn check.** A ticket-agent's `first_turn` is the `first-turn` figure above. #656's target is within 10k of a reviewer's first turn; read it from the first lane row and say so on #656.

## Standing rules

1. **Routing.** The dispatch model follows `CLAUDE.md` § Model tiers (`run-issue` step 2 applies it).
2. **Course content stays outside the repo and the lanes.** The owner's slides, and any slide text they paste into chat, never enter an issue, a comment, a commit or a lane prompt, and no lane reads the owner's deck. A criterion that needs the real deck is the owner's to run locally: the lane reports the command and `Part of` ships (#423's local check). This is wider than the no-real-course-material constraint in `CLAUDE.md`, which covers only what the repo holds.
3. **GitHub writes run as standalone commands.** The allow rules in `.claude/settings.json` match a command only from its start (`Bash(gh issue comment:*)` and the like), so `cd … && gh issue close …`, an `export` ahead of it, or a pipe after it falls to the classifier, which refuses it. One `gh` write per Bash call, `--repo TomBennett-Lloyd/cram.ai`, `--body-file` with an absolute path, no leading `cd`. Reads may be compound. Several refusals on 2026-11-04 came from the compound form before this was diagnosed.
4. **The role's limits.** The merge owner never edits `.claude/agents/**` or `.claude/skills/**` (that is lane work: file an issue), never edits permission settings because a lane asked, and never changes repository settings without the owner's word. It never takes over an action the classifier refused for a lane, with the two exceptions `run-issue` states: finishing a refused rebase or merge, and running a refused `fill-verdict.sh`, both from step 4 or 5. A refusal is reported to the owner, not retried (`.claude/agents/ticket-agent.md` rule 8).

## When this file fails you

A first session's friction is the evidence this file exists. Record what you had to work out that no file told you, what you read that you did not need, and the tool calls before your first useful action, as a `workflow` issue; a lane revises this file against it, because the owner asked for the skill to be optimised from a real start (#659).
