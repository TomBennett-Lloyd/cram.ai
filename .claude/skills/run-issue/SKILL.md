---
name: run-issue
description: Run one GitHub issue via a ticket-agent, or a same-surface batch via a
  task-orchestrator, keeping the top-level session free for parallel issues and merge
  ownership.
---

You are the merge owner, and you own merging and merge-readiness in both lanes below.
`.claude/workflow.json` → `orchestration.routeRule` picks the lane by the ticket SET's
shape — read it there rather than assuming, since `modeHistory`'s superseded values still
resolve in older references. Two dispatch shapes come out of it: a **single issue** goes to
one `ticket-agent` (`.claude/agents/ticket-agent.md`), and a **multi-ticket same-surface
batch** goes to one `task-orchestrator`. Neither lane's procedure is the other's, so pick
the lane before you dispatch; the batch lane's procedure is `batch-lane.md`.

A session that starts as the merge owner runs `.claude/skills/merge-owner-start/SKILL.md`
first: it reconciles state from GitHub, and its § Standing rules bind every step below.

## Ticket-agent lane

1. **Admission**: maintain the in-flight table in your session-state scratchpad file
   (issue, agent handle, phase, footprint, branch; the footprint once the plan comment
   lands). A row leaves the table only at RELEASE. Predict the footprint from the issue body and
   name any known in-flight overlap in the dispatch prompt, so the agent either plans around
   it or expects the rebase. Before dispatch, read the issue as it stands through
   `bash .claude/scripts/gh-owner-comments.sh issue <n>` (`docs/standards/security.md` rule 6;
   exit 3 means the owner did not file it, so it is neither planned nor dispatched and the
   owner is told in chat and files an issue of their own to take it up; every other read of issue or PR
   text in this skill — plan-comment ticks, `Depends on` lines, the RETRO NOTES comment — goes
   through the same script) — every
   issue, however filed, owner-filed included (#369) — reading each
   acceptance bullet against the `## Decision` points of every ADR
   `docs/adr/README.md` § Index lists, read at `origin/main`, a row annotated superseded
   pointing at the superseding ADR as the owner. A bullet is an ADR's when satisfying it would edit a file under `docs/adr/**` — a
   Decision point reversed or extended, a member added to a set a point enumerates (a
   golden-question field, a report metric, a vocabulary member), or a stated value moved,
   which `docs/adr/README.md` § Amendments makes an ADR edit too — or would contradict a
   point as it stands: #369 (`docs/adr/0004-storage.md` § Decision (d), PR #432), #393
   (`docs/adr/0005-evaluation-as-gate.md` § Decision (c)/(d), PR #407, split to #395) and
   #367 (`docs/adr/0001-grounding-architecture.md` § Decision (d) /
   `docs/adr/0003-model-roles-and-backends.md` § Decision (d), PR #397) each stopped at
   plan time instead (#433). An owned bullet takes one of two outcomes, by
   `.claude/agents/ticket-agent.md` rule 2's one-honest-PR test applied to the issue with
   the ADR edit inside it: **label** — `gh issue edit <n> --add-label adr`, plus a body line
   naming the bullet and `docs/adr/<file>.md § Decision (<x>)`; or **split** —
   `gh issue create --label adr` for the owned bullet(s), its body naming the point(s), the
   new number `<m>` taken from that command's output and never predicted, the moved bullet
   struck from the original, whose body gets `Depends on #<m>` where the remainder needs
   the decision first. Either way the labelled issue takes this lane with step 3's relay and
   is never a batch member (`batch-lane.md` step 2). The in-flight row records the ADRs read, at
   the `git rev-parse --short origin/main` commit, and each bullet's verdict (`none owned`,
   or bullet → point → label or split); step 2's list is not widened, since the lane reads
   the verdict from the issue. Rule 2's `adr` stop and `BLOCKED — needs splitting`, and
   step 3's label re-check, stay the backstop: a lane stop caused by an owned bullet this
   read missed is a retro signal naming this step (owner decision 2026-11-02, #433).
   A single lane never holds for another lane's plan — overlap is
   priced as rebase cost, and only entangled same-file SOURCE overlap is batched or
   sequenced, here, at dispatch. Two **eval-bearing** lanes overlap there too, on
   `eval/recordings/` and `eval/reports/`, which neither issue names because the run
   generates them. A lane is eval-bearing when its predicted footprint meets a trigger path
   of `docs/adr/0005-evaluation-as-gate.md` § Decision (g), or holds anything else that owes
   a `pnpm eval` run under `eval/README.md`'s tier-1 paragraph (this definition is owned here: `.claude/ledgers/eval-bearing-lane.ledger`). Sequence the second, or
   admit it with step 2's overlap note naming the first as the lane its tier-2 run waits
   for (`.claude/skills/eval-lane/SKILL.md` § 1): six lanes re-recorded or lost a run
   without this (#486). `conserve` budget mode: one lane.
   **Load gate** (owner, 2026-11-04, #483): immediately before every dispatch, in either
   lane, read `sysctl -n vm.loadavg` and `sysctl -n hw.ncpu`; while the middle figure, the
   5-minute load average, is above twice the core count, hold the lane. A held lane
   keeps its in-flight row, marked `held: load <x>`, and goes out once a later read shows the
   figure at or under that line; re-read at every report and merge. The hold lifts on the
   measurement alone: it is not a sequencing decision and never a reason to batch. While anything is
   held, `bash .claude/scripts/sweep-worktrees.sh --dry-run` lists as `WOULD-KILL` the
   orphans `.claude/scripts/sweep-orphans.sh`'s header defines, which a real sweep ends. The
   evidence, lanes' verify runs red on load timeouts, is #483's. The gate bounds dispatch; `.claude/scripts/verify-guard.sh` separately bounds how many `pnpm verify` runs execute at once (#700).
2. **Dispatch** `ticket-agent` with the issue number, the main-checkout path, the budget
   mode and the overlap note — nothing else; it reads the issue (through the script above)
   and the files.
   The overlap note asserts only what a command printed: each overlapping lane's issue or
   PR with its files pasted from `gh pr diff <m> --name-only`, or from the lane's plan
   comment before it has a PR. A rule or precedent the note leans on is cited by file and
   section (`` `<path>` § <section> ``) or by issue or PR number, never paraphrased, because
   the lane takes a paraphrase as fact: the #36 dispatch named the wrong precedent PR
   (PR #86), and the #234 note credited `docs/standards/structure.md` with a rule it does
   not state (PR #246).
   **Model**: the dispatch follows `CLAUDE.md` § Model tiers. An issue whose predicted footprint
   is docs-tier (every changed path `.md`) or `.claude/` scripts and prose goes
   out with `model: 'sonnet'` in the Agent call (routing experiment, owner 2026-11-04, #624), as does
   an issue that is a batch of a trim campaign under `docs/standards/prose.md` § Trim batches
   (cumulo#545's batches, cumulo#607's pilot); every other issue keeps the agent's frontmatter model.
   The `reviewer` it dispatches keeps its frontmatter model. A lane whose footprint grows past its
   route reports it and finishes: the tally records the model it ran on.
   **`run_in_background: true`**, which is the opposite of the rule in
   `.claude/agents/task-orchestrator.md` rule 4 and does not contradict it: that rule governs
   what an orchestrator spawns, and the reason it exists — a nested child's completion routing
   past its parent to you — cannot arise for your own direct child, whose completion IS the
   lane report arriving. Silence until that report is the healthy state; do not poll. If the
   notification is lost the report is still durable: `bash .claude/scripts/gh-owner-comments.sh pr <n>`,
   or the same with `issue <n>` for its comments.
3. **Approval relay** — a touchpoint only an `adr` issue, or a plan holding a question only
   the owner can answer, reaches. The agent posts its plan comment and returns
   `STATUS: BLOCKED — owner decision: <the plan summary and the questions>`; put that
   summary and the plan comment's link to the owner in chat, and send the answer back to the
   warm agent verbatim — `PROCEED — <the owner's words>` or `REVISE — <feedback>`
   (`.claude/agents/ticket-agent.md` rule 2), a `REVISE` returning to this step. The
   `approved-at-plan` fill a `PROCEED` can lead to runs in the lane under step 4's bare form
   and its no-retry rule.
   `planApproval.alwaysRequiredFor` is enforced twice — by the agent's stop, and by your own
   `gh issue view <n> --json labels` on its first report, so an `adr` issue that reaches step
   4 without this relay goes back to it — and never skipped: a `PROCEED` the owner did not
   give is not one to send. `/plan-issue` + `/execute` is no longer the default path for an
   `adr` issue (owner decision 2026-10-16, #49); they remain for batches and for a lane that
   returns `BLOCKED — needs splitting`.
4. **Diff check** — your first touchpoint past any approval relay, and your only read of
   the code. `git rev-parse <branch>` must equal the report's HEAD, or stop and reconcile
   before anything else. Check
   the changed files against the plan comment's files (drift named, or none); every `Verify`
   and `CI` field pasted rather than summarised; CI green on the reported head. Then read
   `gh pr diff <n>` for three things: scope (only this ticket's work), suppressions
   (`gh pr diff <n> | command grep -nE 'eslint-disable|@ts-expect-error|as any'`, with a
   positive control against a scratch line holding one), and classification against the
   extensions the diff actually carries. Findings go back as one `FIX — <finding>` message to
   the warm agent, which returns a refreshed report. **Two FIX bounces on one ticket is the
   cap**: past that, report to the owner instead of bouncing a third time. Then the merge
   chain of `.claude/skills/review-loop/SKILL.md` step 5, unchanged — including the
   `humanAlways` ritual, and the merge-time `Category`/`Verdict` fill, which reaches the agent
   as a bounce because only it writes to its worktree:
   `FILL — bash .claude/scripts/fill-verdict.sh <pr> --category <category> --verdict "<text>" --worktree <path>`,
   filled in and sent verbatim. The agent runs it bare, as `docs/standards/evidence.md` § Host
   conventions member 10 states (#205); an agent the classifier refuses returns `BLOCKED` with
   its git state and never retries (`.claude/agents/ticket-agent.md` rule 8), and you then run the same bare command yourself. On an `/execute`-path branch, which has no lane agent, you run it
   yourself from the start. A report whose `Cross-references:` field reads `unposted` leaves
   you the posting: post each from the text in the PR body yourself, before the merge
   chain, naming the lane in the comment (`.claude/agents/ticket-agent.md` rule 1; PR #425
   left five unposted, #427).
   An ADR PR whose report reads `Extras beyond the approved plan: none`
   (`.claude/workflow.json` → `merge.approvedAtPlanRule`) owes neither that bounce nor the
   label — the lane filled the entry before reporting — and your diff check reads one thing
   more: the pasted Decision mapping, against the plan comment as it stood at the `PROCEED`
   and against the ADR's § Decision. An extra the lane did not list is a `FIX —` bounce,
   never a merge.
   An ADR amendment whose report names a `merge.amendmentRule` arm in `Classification:`
   owes that bounce and the label no more. For arm (a) your diff check reads the plan comment's edit history,
   where the amendment's text must predate the branch's first commit to the ADR;
   `merge-pr.sh` checks the diff for either arm.
   **Merge order** — whenever a PR is ready (this step's diff check done, CI green on the
   reported head) and another PR is ready or another lane is in flight, in both lanes: read
   `.claude/skills/run-issue/merge-order.md` and follow it.
   **`bash .claude/scripts/merge-pr.sh <pr>` runs that chain's mechanical half for you**, through
   the label removal and worktree reap after the merge; its header and step comments own what each
   step does. It is re-runnable from any state, so the repair for a chain that dies mid-poll is to
   run it again. It never fills a **Verdict**, so the fill above stays a bounce to the agent, and
   every judgement this prose owns stays yours.
5. **Rebase hand-off** — your next touchpoint, and only when `main` moved. This step owns
   when an open PR is brought current. After every merge, read
   `gh pr view --json mergeStateStatus` on each open lane PR, and each `DIRTY` one's
   conflicted set (below), into its in-flight table row; then act on the **next** PR
   alone — the head of `merge-order.md`'s **Merge order** over the ready set (an `awaiting-review` PR
   joins it at the owner's approval), which by key (1) is a ready PR an in-flight lane
   `Depends on` when there is one. Every other open PR is recorded and left, because
   the next merge makes any head bought for it now stale again, and only the
   update-branch the merge itself runs buys a head that can merge (#614). Two exceptions
   act on a PR that is not next. A non-log `DIRTY` on a PR whose lane is still at work —
   PR open, no report yet — takes the `REBASE —` bounce at once, since the conflict is
   cheapest close to its cause and the lane still holds the context.
   An `awaiting-review` PR is never brought current while it waits on the owner's word —
   PR #499 merged `main` three times while it waited, and none of those heads was the one
   that merged (#614) — so its recorded state goes in the review-guide relay, and on the
   approval it is next and takes the one round below that its state then calls for. When
   that round is a `REBASE —` bounce, relay the resolution to the owner before the merge,
   since the approval covered the head before it, as pasted
   `git range-diff <old base>..<approved head> origin/main..<new head>`, or
   `git show --remerge-diff <merge commit>` on a branch that took `main` by merge.
   For the next PR: `BEHIND` → nothing here; `bash .claude/scripts/merge-pr.sh <pr>` runs
   `gh pr update-branch` as the merge's own first step, and that is the one CI round. A
   `--rebase` batch, `BEHIND` or `DIRTY`, takes `batch-lane.md` step 4's curate bounce. `DIRTY` →
   after `git fetch origin`, set `b=origin/<branch>` and read the conflicted set,
   `git merge-tree --write-tree --name-only --no-messages origin/main "$b" | tail -n +2`.
   Every path in it one of `.claude/scripts/merge-pr.sh`'s `APPEND_ONLY_LOGS` → no bounce:
   the PR waits as it is, and `bash .claude/scripts/merge-pr.sh <pr>` unions the conflict at
   merge in its update-branch step, or refuses, naming why (#297). Any other path, or that
   refusal → a `REBASE —` bounce to the
   warm agent, which rebases per its rule 8 and re-reports. On a branch whose diff against
   `origin/main` adds or updates a file under `eval/reports/` — the second of two
   eval-bearing PRs in `merge-order.md` among them — the bounce reads
   `REBASE — merge origin/main (ADR 0005 (f))`; `.claude/skills/eval-lane/SKILL.md` § 2 owns why
   the lane merges and does not rebase. The
   second merger takes `main` in one of these two forms, always; merges serialise, in `merge-order.md`. The bounce carries pasted command output
   and citations, and no
   figure of its own. Set `base=$(git merge-base origin/main "$b")`, then paste:
   (a) `git log --oneline "$base"..origin/main`, what merged since the branch was cut;
   (b) `git diff "$base" origin/main -- <file>` for each file both sides touched, that set
   printed by
   `comm -12 <(git diff --name-only "$base" origin/main | sort) <(git diff --name-only "$base" "$b" | sort)`;
   (c) for each append-only log in that set (`.claude/scripts/merge-pr.sh`'s
   `APPEND_ONLY_LOGS`), the heading lines each side adds or deletes, read from that file
   alone: `git diff "$base" origin/main -- <log> | command grep -E '^[-+]## '`, then the same
   with `"$b"`. Never read them from `gh pr diff <n>`, whose whole-diff grep also returns
   every other file's `## ` headings: `docs/review-feedback.md`'s entry heading put the
   expected `docs/tech-debt.md` count one too high in the #165 and #179 bounces (PRs #266
   and #269). The union rule is
   cited as `.claude/skills/review-loop/SKILL.md` step 5, not restated; the lane's own
   arithmetic there is the check, and (c) is its input. A PR that opened `DIRTY` on those
   logs alone is the lane's to clear before its report (`.claude/agents/ticket-agent.md`
   rule 7, #279), so a report arriving with one is a step 4 `FIX —`. A `DIRTY` that
   arrives after the report takes this step's arms above as the PR comes next — logs alone
   wait for `merge-pr.sh`'s union, any other path is the `REBASE —` bounce — because the lane
   pushes nothing unprompted after `DONE` (`.claude/agents/ticket-agent.md` rule 5).
   A lane that returns `BLOCKED` on a refused conflict resolution has stopped mid-rebase, or
   mid-merge on an eval-report branch, and pushes nothing more, which makes the worktree
   yours: finish that rebase or merge there — git only, under every rule
   `.claude/skills/review-loop/SKILL.md` step 5 states for it — the verify `.claude/agents/ticket-agent.md` rule 4 calls for (none after a clean merge), push the branch
   (forced after a rebase, plain after a merge), then run any fill the PR still owes per
   step 4 (#205).
6. **Release**: PR merged, issue closed, no bounce open → post the lane's row on #624
   (`.claude/skills/merge-owner-start/SKILL.md` § Owed checks, retros and the tally); the
   `## Lane report` in the PR body is the retro's first-hand input, and the retro may be a
   combined one (`.claude/skills/retro/SKILL.md` step 0), so the row leaves the table without
   waiting for it. A wedged agent (no report,
   no branch movement) gets the worktree and the issue inspected FIRST, then `TaskStop`, then
   a fresh `RESUME issue #n` dispatch — the new agent reconciles from
   `git log origin/main..<branch>`, `git status`, the plan comment and any PR, adopts
   what is already done, and checks the plan's Standing facts (`.claude/agents/ticket-agent.md`
   rule 2).

   A dead lane is recognised, not diagnosed: the task shows no progress or an `ENOTFOUND` /
   stall-watchdog failure, its output file is a few hundred bytes, and `ps` shows no process
   under the worktree — a 0-byte background task entry alongside it is a ghost of a command
   whose owner died, safe to stop. Then `RESUME`: the new agent audits uncommitted work
   against the plan comment's ticks before adding to it, and never re-does a step whose
   files exist.

## Batch lane

A multi-ticket same-surface batch follows `.claude/skills/run-issue/batch-lane.md`: read it when
`.claude/workflow.json` → `orchestration.routeRule` picks a batch.
