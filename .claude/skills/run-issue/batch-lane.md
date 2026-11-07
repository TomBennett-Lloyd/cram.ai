# Batch lane

Moved out of `.claude/skills/run-issue/SKILL.md` by #668, which keeps the pointer: read this file when
`.claude/workflow.json` → `orchestration.routeRule` picks a batch. Step numbers without a file name are
this file's; `SKILL.md`'s are named.

1. **Admission**: maintain the in-flight table in your session-state scratchpad file
   (issue, agent handle, phase, footprint, branch). A row leaves the table only at
   RELEASE. No fixed concurrency cap — **maximize safe parallelism** (owner, 2026-08-09,
   clarified 2026-08-10): isolation quality is the gate — admit every candidate whose
   footprint is cleanly isolated from (or trivially rebasable against) everything in
   flight; entangled candidates hold, or batch. `SKILL.md`'s ticket-agent lane step 1 load gate
   holds every dispatch while the machine's load reads over its line (#483). Never hold
   work back merely to conserve your own context: each set costs you only reports and a
   table row by design, and delegation is itself the fix for context pressure. Context
   health is a sanity backstop only — if in-flight sets are somehow costing more than that
   (bounce chatter, bloated reports), fix the contract breach; don't slow admission.
   Conserve budget mode is the one fixed cap: 1 concurrent set. Each candidate's acceptance is read per `SKILL.md`'s ticket-agent lane step 1 before step 2's composition test, so the `adr` label that test keys on is
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
   at a time — merges are serialized, always, per `merge-order.md`. That ritual is a single issue's only: a batch carries no humanAlways
   path (step 2), so a batch TASK REPORT classifying HUMAN, or a batch changed-file list
   holding a humanAlways path, is a `FIX` bounce naming the member to drop, never a fill.
   Single-issue PRs merge `--squash` as today; batch PRs merge `--rebase` AFTER the mechanical curated-history check passes — the
   report's branch commit list must show commit count == surviving-member count, each
   commit referencing its member issue, and `git log --oneline origin/main..<branch>`,
   after `git fetch origin`, must match it — never local `main`, which the parked checkout
   moves only when the merge owner pulls (#95). CI green AND curated history are both
   required; either failing blocks the merge.
   `merge-pr.sh` (`SKILL.md` ticket-agent lane, step 4) runs this chain for a batch too, and knows
   the three differences: it checks the curated history itself, from the PR's commit list
   on GitHub, and refuses without it; it refuses a `--rebase` PR that classifies HUMAN,
   naming routeRule, ahead of that check, and leaves naming the member to your `FIX` bounce; and
   it never runs `gh pr update-branch` on a `--rebase` PR — it reports the bounce below
   instead of taking it, since only the branch's owner can curate and force-push.
   A batch that is BEHIND or conflicted gets a "curate onto latest main" bounce instead of
   `gh pr update-branch` (a merge commit would break the invariant and block rebase-merge),
   sent when it is next (`SKILL.md` ticket-agent lane step 5, which owns when a head is brought current);
   after the force-push, wait for the new head's checks as usual, that head's place in the
   queue set by the same **Merge order** (`merge-order.md`). HUMAN-class (a
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
