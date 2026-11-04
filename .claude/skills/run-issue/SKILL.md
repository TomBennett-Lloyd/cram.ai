---
name: run-issue
description: Run one GitHub issue via a ticket-agent, or a same-surface batch via a
  task-orchestrator, keeping the top-level session free for parallel issues and merge
  ownership.
---

Ported from cumulo (https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`.

You are the merge owner, and you own merging and merge-readiness in both lanes below.
`.claude/workflow.json` → `orchestration.routeRule` picks the lane by the ticket SET's
shape — read it there rather than assuming, since `modeHistory`'s superseded values still
resolve in older references. Two dispatch shapes come out of it: a **single issue** goes to
one `ticket-agent` (`.claude/agents/ticket-agent.md`), and a **multi-ticket same-surface
batch** goes to one `task-orchestrator`. Neither lane's procedure is the other's, so pick
the section before you dispatch.

## Ticket-agent lane

1. **Admission**: the same in-flight table as below (issue, agent handle, branch, and the
   footprint once the plan comment lands). Predict the footprint from the issue body and
   name any known in-flight overlap in the dispatch prompt, so the agent either plans around
   it or expects the rebase. Before dispatch, read the issue body as it stands — every
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
   is never a batch member (batch lane step 2). The in-flight row records the ADRs read, at
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
   a `pnpm eval` run under `eval/README.md`'s tier-1 paragraph. Sequence the second, or
   admit it with step 2's overlap note naming the first as the lane its tier-2 run waits
   for (`.claude/agents/ticket-agent.md` rule 6): six lanes re-recorded or lost a run
   without this (#486). `conserve` budget mode: one lane.
2. **Dispatch** `ticket-agent` with the issue number, the main-checkout path, the budget
   mode and the overlap note — nothing else; it reads the issue and the files.
   The overlap note asserts only what a command printed: each overlapping lane's issue or
   PR with its files pasted from `gh pr diff <m> --name-only`, or from the lane's plan
   comment before it has a PR. A rule or precedent the note leans on is cited by file and
   section (`` `<path>` § <section> ``) or by issue or PR number, never paraphrased, because
   the lane takes a paraphrase as fact: the #36 dispatch named the wrong precedent PR
   (PR #86), and the #234 note credited `docs/standards/structure.md` with a rule it does
   not state (PR #246).
   An issue that is a batch of a trim campaign under `docs/standards/prose.md` § Trim batches
   (cumulo#545's batches) goes out with `model: 'sonnet'` in the Agent call, cumulo#607's pilot; the
   `reviewer` it dispatches keeps its frontmatter model.
   **`run_in_background: true`**, which is the opposite of the rule in
   `.claude/agents/task-orchestrator.md` rule 4 and does not contradict it: that rule governs
   what an orchestrator spawns, and the reason it exists — a nested child's completion routing
   past its parent to you — cannot arise for your own direct child, whose completion IS the
   lane report arriving. Silence until that report is the healthy state; do not poll. If the
   notification is lost the report is still durable: `gh pr view <n> --json body`, or the
   issue's comments.
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
   filled in and sent verbatim. The agent runs it exactly as sent, from any cwd, with no `cd`,
   `export`, prefix, pipe or redirect, because the owner's permission allow rule matches the
   bare form and nothing wrapped around it (#205). An agent the permission classifier refuses
   once, on that fill or on a rebase's conflict resolution, returns `BLOCKED` with its git
   state and never retries (`.claude/agents/ticket-agent.md` rule 8); you then run the same
   bare command yourself. On an `/execute`-path branch, which has no lane agent, you run it
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
   **Merge order** — whenever a PR is ready (this step's diff check done, CI green on the
   reported head) and another PR is ready or another lane is in flight, in both lanes
   (batch lane step 4 cites this). It orders ready PRs, and holds one only for the
   single wait key (2) prices below, never as a blanket hold. Its inputs: the ready set;
   the in-flight table (batch lane step 1) — each lane's phase (before its first
   `pnpm verify`, reviewer pass or PR, or PR open; for a ticket-agent row, read from
   `git log origin/main..<H>`, the plan comment's ticks and `gh pr list --head <H>`) and
   the `Depends on` lines of its issue body and plan comment; and, after `git fetch origin`, the overlap
   read for each ready PR `R` against each other in-flight branch `H`, read as the local
   ref `<H>`, since worktrees share `refs/heads` and a lane pushes nothing before its PR
   (a lane with no commits yet is priced on its plan comment's footprint against
   `gh pr diff <R> --name-only` instead):
   `out=$(git merge-tree --write-tree --name-only --no-messages origin/main origin/<R>); rc=$?; T=${out%%$'\n'*}`
   (the tree is line 1; `rc=1` with a path from line 2 on outside the logs named below:
   `R` is not ready), then `C=$(git commit-tree "$T" -p origin/main -m probe)` (a
   dangling throwaway commit, left to gc), then the two reads in step 5's form, each with
   its exit code and read from line 2:
   `git merge-tree --write-tree --name-only --no-messages "$C" <H>` and
   `git merge-tree --write-tree --name-only --no-messages origin/main <H>`.
   The paths the first lists and the second does not, less
   `.claude/scripts/merge-pr.sh`'s `APPEND_ONLY_LOGS` (that script unions them), are what
   `R`'s landing adds to `H`'s conflicts; an empty difference means `R` adds none. What
   each open head then pays is owned elsewhere: a single-issue PR `BEHIND` takes
   `gh pr update-branch`, yours and mechanical, and `DIRTY` on a non-log path takes a
   `REBASE —` bounce, lane-side (both step 5); a `--rebase` batch, `BEHIND` or `DIRTY`
   alike, is refused by `.claude/scripts/merge-pr.sh`'s merge step and takes a "curate
   onto latest main" round, lane-side (batch lane step 4) — PR #394 paid two, the second
   landing only while other merges were held (#413). Two keys order the set, in
   precedence. (1) Unblocking impact: a ready PR an in-flight lane `Depends on`, or whose
   read against an in-flight branch that is still before its verify, review or PR comes
   back non-empty, goes first, so the conflict lands before that lane's PR rather than
   after it; neither lane's agent file yet takes a rebase before its first report, so the
   lane still pays it at step 5, and #448 owns the entry that would let it rebase before
   it invests. (2) Among the rest, the PR
   whose landing costs the other open heads the fewest lane-side rounds goes first, ties
   to the one ready longest; the heads counted include a curated batch whose checks are
   still running on its new head, so a ready PR whose landing would cost that batch
   another round waits for that one CI run — the one wait this order prices. A curated
   batch is priced by (2), not special-cased (owner direction 2026-11-02, #413). Two
   ready eval-bearing PRs (step 1) overlap whatever the read prints, since each committed
   run stands for its whole tree (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)):
   the one whose tier-2 run is committed goes first, and the other takes one step 5
   `REBASE —` bounce to re-record after it lands, even when it reads only `BEHIND`, because
   `gh pr update-branch` cannot re-record. No run in progress is overtaken (#486). The
   order and the read it rests on — commands, output and exit codes, written from the captured run
   (`docs/standards/evidence.md`) — go in the in-flight table rows, never into issues.
   **`bash .claude/scripts/merge-pr.sh <pr>` runs that chain's mechanical half for you** —
   `gh pr update-branch` with retries against the head-sha race, the pending-aware checks
   poll, a merge taken only from `CLEAN` and pinned with `--match-head-commit` to the
   head whose checks it read, and then, only once the PR reports `MERGED`, the
   label removal, the `Closes`-issue check and the worktree reap. It is idempotent and
   re-runnable from any state, so the repair for a chain that dies mid-poll is to run it
   again; a failure names the step the next run resumes from. It never fills a **Verdict** —
   a `humanAlways` PR whose entry still carries the `pending — filled at merge` placeholder
   is refused outright — so the fill above stays a bounce to the agent, and every judgement
   this prose owns stays yours.
5. **Rebase hand-off** — your next touchpoint, and only when `main` moved. After every
   merge, `gh pr view --json mergeStateStatus` on each open lane PR. `BEHIND` → run
   `gh pr update-branch` yourself; it is mechanical. `DIRTY` → after `git fetch origin`, set
   `b=origin/<branch>` and read the conflicted set,
   `git merge-tree --write-tree --name-only --no-messages origin/main "$b" | tail -n +2`.
   Every path in it one of `.claude/scripts/merge-pr.sh`'s `APPEND_ONLY_LOGS` → no bounce:
   the PR waits as it is, and `bash .claude/scripts/merge-pr.sh <pr>` unions the conflict at
   merge in its update-branch step, or refuses, naming why (#297). Any other path, or that
   refusal → a `REBASE —` bounce to the
   warm agent, which rebases per its rule 8 and re-reports. On a branch whose diff against
   `origin/main` adds or updates a file under `eval/reports/` — the second of two
   eval-bearing PRs in step 4's **Merge order** among them — the bounce reads
   `REBASE — merge origin/main (ADR 0005 (f))`, and the lane merges rather than rebases,
   under the same rule 8, so the commit its report measured stays in the PR's history. The
   second merger takes `main` in one of these two forms, always; merges serialise, in step
   4's **Merge order**. The bounce carries pasted command output and citations, and no
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
   arrives after the report takes this step's arms above unchanged — logs alone wait for
   `merge-pr.sh`'s union, any other path is the `REBASE —` bounce — because the lane
   pushes nothing unprompted after `DONE` (`.claude/agents/ticket-agent.md` rule 5).
   A lane that returns `BLOCKED` on a refused conflict resolution has stopped mid-rebase, or
   mid-merge on an eval-report branch, and pushes nothing more, which makes the worktree
   yours: finish that rebase or merge there — git only, under every rule
   `.claude/skills/review-loop/SKILL.md` step 5 states for it — re-verify, push the branch
   (forced after a rebase, plain after a merge), then run any fill the PR still owes per
   step 4 (#205).
6. **Release**: PR merged, issue closed, no bounce open → the `## Lane report` in the PR body
   is the retro's first-hand input; run `/retro`; remove the row. A wedged agent (no report,
   no branch movement) gets the worktree and the issue inspected FIRST, then `TaskStop`, then
   a fresh `RESUME issue #n` dispatch — the new agent reconciles from
   `git log origin/main..<branch>`, `git status`, the plan comment and any PR, and adopts
   what is already done.

   A dead lane is recognised, not diagnosed: the task shows no progress or an `ENOTFOUND` /
   stall-watchdog failure, its output file is a few hundred bytes, and `ps` shows no process
   under the worktree — a 0-byte background task entry alongside it is a ghost of a command
   whose owner died, safe to stop. Then `RESUME`: the new agent audits uncommitted work
   against the plan comment's ticks before adding to it, and never re-does a step whose
   files exist.

## Batch lane

1. **Admission**: maintain the in-flight table in your session-state scratchpad file
   (issue, agent handle, phase, footprint, branch). A row leaves the table only at
   RELEASE. No fixed concurrency cap — **maximize safe parallelism** (owner, 2026-08-09,
   clarified 2026-08-10): isolation quality is the gate — admit every candidate whose
   footprint is cleanly isolated from (or trivially rebasable against) everything in
   flight; entangled candidates hold, or batch. Never hold work back merely to conserve
   your own context: each set costs you only reports and a table row by design, and
   delegation is itself the fix for context pressure. Context health is a sanity backstop
   only — if in-flight sets are somehow costing more than that (bounce chatter, bloated
   reports), fix the contract breach; don't slow admission. Conserve budget mode is the
   one hard cap: 1 concurrent set. Each candidate's acceptance is read per the
   ticket-agent lane's step 1 before step 2's composition test, so the `adr` label that test keys on is
   on the issue, and any split the read produces is itself a candidate or a dependency
   outside the batch, by then.
2. **Dispatch** `task-orchestrator` (background) with: the issue number (or, for a batch,
   the member list + anchor issue) and the main-checkout path. Nothing else — it reads the
   skills and the issue(s). **Batch composition is yours, at admission**: overlapping
   footprints among SMALL tickets (debt-burn scale, 1–2 chunks each) on one surface are the
   signal to batch, not hold — 2–6 members, ≤8 predicted chunks total, no `adr` label, no
   expected humanAlways paths, no dependency outside the batch, and nothing too large or
   entangled to be told as one honest commit (each member lands on main as exactly one
   commit and is its own revert unit). The humanAlways clause is
   `.claude/workflow.json` → `orchestration.routeRule`'s, and it binds after admission
   too: a member found mid-flight to reach a humanAlways path drops out of the batch
   (`task-orchestrator.md` rule 7) and comes back to you as its own ticket-agent lane.
   One batch = one agent = one in-flight row (footprint union). **The agent goes quiet after the dispatch and stays quiet until its
   next contract report** (`task-orchestrator.md` rule 6 bans interim narration), and its own
   sub-agent dispatches are synchronous, so no sub-agent completion notification for that set
   should reach you at all — one that does is a contract breach worth naming in the retro,
   not a message to relay. Silence between reports is the healthy state; do not poll it.
3. **On PLAN CHECKPOINT**: independently re-check the gates (`gh issue view <n> --json
labels` for planApproval.alwaysRequiredFor; read the plan's Risks for user-only
   questions) — the agent declares stops, you enforce them, and a gated plan waits for the
   owner exactly as before. Then intersect the footprint with every in-flight footprint
   (docs/tech-debt.md excluded — its conflict is expected and handled at merge). Clear →
   SendMessage `PROCEED — footprint accepted`. Held → record the hold and its reason;
   re-check when the blocker merges.
4. **On TASK REPORT**: verify disk truth in one command (`git rev-parse <branch>` vs the
   reported HEAD — mismatch: stop, reconcile from the issue ledger before anything else);
   cross-check the classification against the changed-file list; check the changed files
   against other in-flight tasks. Then the merge chain of review-loop step 5 (which owns
   update-branch, the append-only-log union routine, the settle-then-watch, and all of the
   ritual still owed at merge time — filling that PR's review-feedback entry
   **Category and Verdict**, both placeholders and never just one, on
   the branch, in the shape `docs/review-feedback.md`'s `## Entry format` declares, which
   being a branch commit necessarily precedes the merge; then the merge; then taking the
   label off, last of the three, the entry itself having landed on the branch before the
   label ever went on), one PR
   at a time — merges are serialized, always, in the ticket-agent lane's step 4
   **Merge order**. That ritual is a single issue's only: a batch carries no humanAlways
   path (step 2), so a batch TASK REPORT classifying HUMAN, or a batch changed-file list
   holding a humanAlways path, is a `FIX` bounce naming the member to drop, never a fill.
   Single-issue PRs merge `--squash` as today; batch PRs merge `--rebase` AFTER the mechanical curated-history check passes — the
   report's branch commit list must show commit count == surviving-member count, each
   commit referencing its member issue, and `git log --oneline origin/main..<branch>`,
   after `git fetch origin`, must match it — never local `main`, which the parked checkout
   moves only when the merge owner pulls (#95). CI green AND curated history are both
   required; either failing blocks the merge.
   `merge-pr.sh` (ticket-agent lane, step 4) runs this chain for a batch too, and knows
   the three differences: it checks the curated history itself, from the PR's commit list
   on GitHub, and refuses without it; it refuses a `--rebase` PR that classifies HUMAN,
   naming routeRule, ahead of that check, and leaves naming the member to your `FIX` bounce; and
   it never runs `gh pr update-branch` on a `--rebase` PR — it reports the bounce below
   instead of taking it, since only the branch's owner can curate and force-push.
   A batch that is BEHIND or conflicted gets a "curate onto latest main" bounce instead of
   `gh pr update-branch` (a merge commit would break the invariant and block rebase-merge);
   after the force-push, wait for the new head's checks as usual, that head's place in the
   queue set by the same **Merge order**. HUMAN-class (a
   single issue only, per the ritual above): notify the owner with the
   report's review guide — and only via this relay, after you have verified readiness
   (CI green on the reported head) yourself; the label is already on, and there is
   deliberately NO issue @-mention at label time (owner, 2026-08-09: a ping must mean
   "ready for review now", and only the relay carries that guarantee). That readiness
   check is satisfiable rather than circular: the review-feedback entry lands on the
   branch before the label goes on, so green-with-label is the normal state. A red
   `merge-ritual-gate` on a labelled PR is therefore never a PR still waiting for
   something — but read the job's error message before acting on it, because that is
   what separates the two reds: a missing-entry error says the sequence was violated,
   which is a bounce (step 5), while a "could not read the PR" error means the gate
   reached no verdict at all and calls for a re-run of the job, not a bounce at a branch
   with nothing to fix. Neither is a thing to wait out. The agent stays parked either
   way.
5. **Bounce, don't do**: anything ticket-shaped that surfaces before release — owner
   feedback on an awaiting-review PR, which is a single issue's (relay verbatim; the warm
   agent folds it into the branch's docs/review-feedback.md entry in the commit that responds — an on-branch
   edit, so it is never yours to make; an approval with no changes relays the same way,
   as the Category and Verdict to fill), branch-side merge fallout beyond the sanctioned
   append-only-log union routine, a post-merge verification failure, or a question from you or the owner —
   goes to the warm agent by SendMessage. You never edit an in-flight worktree. Each
   mutating bounce ends in a refreshed TASK REPORT; re-verify it as in step 4.
6. **Release**: when the PR is merged, the surviving ticket(s) are closed (a batch's
   dropped members are back on the backlog with status comments — verify, don't assume),
   post-merge verification (if any) has settled, and no bounce is open — SendMessage
   `RELEASE — hand over retro notes`. The handover arrives twice by construction — as the
   agent's reply (a courtesy copy, never consumed as the record) and as the finalized
   RETRO NOTES comment on the issue, the sole authoritative record; confirm the comment
   exists and matches the reply — on divergence the comment wins and the divergence is
   itself flagged in the retro as a contract breach — then decide worktree fate
   and run /retro (review-loop step 6 unchanged) with the handover as first-hand input —
   the retro also asks whether the checkpoint, reports, and handover told you what you
   needed. Only then remove the row. Never release with an unmerged PR unless the ticket
   is being abandoned (then say so in the release message; the handover records the
   abandonment).
7. **Wedged or expired agent** (no notification, no ledger movement — or SendMessage
   fails): inspect the issue ledger and the worktree BEFORE anything else; TaskStop the
   agent if wedged; re-dispatch fresh with `RESUME issue #n` — its reconcile-first step
   adopts completed work instead of duplicating it. The fresh agent inherits the ticket
   INCLUDING the handover duty, continuing the existing RETRO NOTES comment (every prior
   round is already banked there); update the table's handle.
