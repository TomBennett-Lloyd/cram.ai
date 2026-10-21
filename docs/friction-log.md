# Friction log

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13 (header only; cumulo's entries were not carried over)._

Weak signals from `/retro` that don't yet have a clear improvement action — recorded so patterns become visible across tasks ("we churn on X in half of tasks") instead of being forced into premature lessons. `/triage` mines this for repeats (≥3 similar entries, or affecting ≥50% of recent tasks) and converts patterns into workflow issues, deleting captured entries. Singletons stay until they repeat or go stale.

Entry format:

```
## YYYY-MM-DD — PR #n
- Phase: planning | implementation | review | process
- Observed: one concrete observation, no proposed fix required
```

---

## 2026-10-20 — PR #82

- Phase: review
- Observed: the eval course's audit catches a `mustNotContain` entry that appears literally in the deck's own text, but not one that a correct answer _negating_ the slide would trip (the first cycle-1 finding, with three more questions missing a citation to a slide that repeats the answer); the audit's arm is literal, the defect was semantic, and only a reader caught it. One ticket so far; #47's runner is the first consumer that could surface it mechanically.

## 2026-10-20 — PR #89

- Phase: planning
- Observed: the #80 plan claimed `eval/src` would pass the comment-density gate once covered, on the strength of a pre-plan run that measured the old scope (16 files, `eval/` excluded); the widened gate put two files over the median and added a docblock cut to the scope mid-flight. A claim about a widened gate needs the widened gate run first. One ticket so far.

## 2026-10-20 — PR #101

- Phase: planning
- Observed: the first lane to run under `.claude/agents/ticket-agent.md` § 2's new sweep sentence (#87) found a carrier its issue did not name — `task-orchestrator.md` rule 1's reconcile range, which PR #96's narrower sweep had missed — and declared it as a footprint change before the first edit. No new signal; recorded so the next graduation check can see the rule's first catch.

## 2026-10-20 — PR #116

- Phase: implementation
- Observed: the #93 lane wrote `Map.groupBy` into a test fixture; it is ES2024 and the base tsconfig's `lib` is ES2023, so `tsc` refused it before any test ran and the fixture groups by hand. The gate did its job at no cost; recorded because the `lib` ceiling is a value an implementer meets only by hitting it. One ticket so far.

## 2026-10-20 — PR #123

- Phase: planning
- Observed: the #79 plan chose `@napi-rs/canvas` as a devDependency of `eval/` on the reasoning that devDependencies are outside `check:no-network-egress`'s scan. Adding it anywhere in the workspace satisfied `unpdf`'s optional peer, so pnpm re-resolved `@cram/ingest`'s production `unpdf` against it and the gate flagged the Skia binary in ingest's production tree. The lane switched to `jimp` (pure JS, no peer coupling) and re-planned once. A devDependency can change another importer's production tree through optional-peer resolution; only the gate saw it. One ticket so far.

## 2026-10-20 — PR #137

- Phase: review
- Observed: the #78 lane's first commit filtered references slides with one shared `rowid in` clause, which made the FTS5 word search re-run its match once per id, 165 times slower at 3000 slides, and `pnpm verify` stayed green because the retrieval timing test runs only under `CRAM_MEASURE=1`. The reviewer's manual measured run caught it, and #136 now asks what gates a retrieval query-plan or latency regression. One ticket so far; the RESUME after the lane's rate-limit death redid nothing, which is recorded here as the recovery path working rather than as friction.

## 2026-10-20 — PR #118

- Phase: planning
- Observed: issue #57 ended "Decision needed (owner)", and the lane answered the question from the repo's documents instead of stopping BLOCKED, leaving a "Contrary reading" paragraph for the merge owner; the merge owner held the PR for the owner's word, which came a few hours later and agreed. The #56 and #47 lanes, given owner-shaped questions the same day, stopped at the plan. `.claude/agents/ticket-agent.md` § 5 (d) names "owner taste" as a stop trigger and says nothing about an issue that labels its own question as the owner's. One ticket so far on the lane deciding; the reviewer's pathspec finding (an edge no guard-edge mutant named) is the shape #188 now owns.

## 2026-10-21 — PR #167

- Phase: implementation
- Observed: the #20 lane's first live `models:pull` run and its mutant run both preceded the last review edits to the script and harness, so both were redone after review (one cold-path reinstall of a 2.5 GB download, one mutant run). The lane's order was build, measure, review, fix; the fix invalidated the measurement. One ticket so far on measuring before review on a script whose review changes its behaviour.

## 2026-10-21 — PR #177

- Phase: process
- Observed: the rule PR #177 adds was written and merged within two hours of the #159 lane raising an unsanctioned macOS automation prompt (`.claude/agents/ticket-agent.md` § 5 (g)), and the #159 lane itself stopped cleanly on a HOLD, deleted what it had created and reported its probe findings with provenance. No new signal; recorded so the rule's first catch, if any, has its origin dated.

## 2026-10-21 — PR #197

- Phase: implementation
- Observed: the time-box red that #152 recorded at load average 90–100 did not reproduce for its lane at load averages of 41 to 76 on 10 cores (three runs of three green; a bare stub call measured 42 ms at most), so the lane removed the race rather than tuning a margin, with a regression case that fails on the pre-fix harness. A load-dependent red that cannot be reproduced on demand is fixed by construction or not at all; the lane's answer was the right one. One ticket so far.

## 2026-10-21 — PR #215

- Phase: implementation
- Observed: the #16 lane ran `pnpm verify` eleven times, each taking 9 to 15 minutes, while fourteen to sixteen lanes shared the machine at a load average of 90 to 100; one run was a re-run after #152's time-box signature (fixed since by PR #197). The lane's work (86 files, four review passes, a browser-smoke pass) was not the cost; the verify runs were, and most of that was waiting on the other lanes' runs. The parallelism bought wall-clock across tickets and paid it back inside each. One lane's figures so far; the effort pilot (#140) records tokens and duration per lane and is where the trade-off becomes visible.

## 2026-10-21 — PR #248

- Phase: planning
- Observed: the #231 lane's plan comment described its first design (a stub that returned a `holdAsk()` closure) in detail; review replaced it with a named option under `docs/standards/structure.md` rule 2, and the plan comment then cost two confirmation rounds of prose drift, because struck text beside new text read as still live and only rewriting the sections whole passed. One ticket so far on a plan comment that commits to a shape before review has seen it.

## 2026-10-21 — PR #260

- Phase: implementation
- Observed: the #194 lane could not bank one file's comment-density drop inside its ticket, because `check-comment-density.sh --ratchet` writes a row for every unbanked file in the repo on the same run (151 here), and the lane reverted the run rather than carry 151 unrelated rows in a feature PR. Second instance of the baseline shaping a lane's choices (PR #73's entry was the first, captured into #187); PR #252 banks every file's row, which removes the unbanked rows a later `--ratchet` would sweep in. Nothing to change while that PR waits for the owner.

## 2026-10-21 — PR #263

- Phase: implementation
- Observed: the #233 plan split the shared `IngestStatus` shape change (step 2) from the web consumer that answers it (step 3), and the lane had to land both in one commit because `pnpm verify` is whole-repo and the web package is red between them. A plan step that changes a shared type is not committable on its own; nothing in `.claude/agents/planner.md` asks whether a step's `Verify:` can pass before its consumers move. One ticket so far.

## 2026-10-21 — PR #277

- Phase: review
- Observed: #254 merged mid-lane and changed stored output, which falsified the #257 plan's "no bump owed"; the reviewer found it by reading `origin/main`, a base the lane may not rebase onto unprompted, so the fact reached the lane at review rather than at the plan, and the rebase round then ran twice because #275 merged during the first. The lane also flagged one message-only `git commit --amend --no-verify`, used to reword a replayed commit whose body line began `#254` and so tripped the `^[#;]` body check; the tree had already passed verify and the final verify and CI ran on it. One ticket so far on each.

## 2026-10-21 — PR #291

- Phase: implementation
- Observed: the frontend-gate probe harness compares sets of `line:rule` pairs and merges duplicates, so it cannot see a rule reporting one fault twice; the #280 lane added a counting case for its own rule only. The lane also spent one fix round after removing comment handling on the measurement that postcss strips comments, which holds except for a comment with no whitespace on either side. One ticket so far on each.

## 2026-10-21 — PR #310

- Phase: planning
- Observed: issue #295, written by the merge owner from the triage pass, placed the `run-issue` skill's DIRTY arm at "step 4"; on disk it is step 5, and the lane found that out by reading the file. An unchecked merge-owner claim reaching a lane in an issue body, the shape #295 itself captures (PRs #86, #246, #266/#269 were in a dispatch note and two bounces). Counts toward #295's measurement, which stays open until three bounces and ten reports have run under PR #310's text.

## 2026-10-21 — PR #313

- Phase: planning
- Observed: the #283 plan set pdf.js's deletion of `<` and `>` aside as out of scope without checking it against the inverse the plan relied on, and the reviewer found that the deletion can break that inverse because pdf.js edits the string it reorders (filed as #305). The lane also rewrote three regex lines twice because a `\uXXXX` escape typed into a tool parameter arrives as the literal character. One ticket so far on each.

## 2026-10-21 — PR #313 (merge)

- Phase: process
- Observed: `merge-pr.sh`'s first run on PR #313 did `gh pr update-branch`, polled the new head green, and then refused at the merge step because the PR was `BEHIND` again: the #310 retro PR had merged during the poll. The merge owner's retro chains and lane-PR merges each serialise behind the merge they queue on, but not behind each other, so two independent chains can land one PR inside another's checks poll and cost it a full second CI round. First instance recorded; PR #235's entry (poll budget) was a different cause.

## 2026-10-21 — PR #315

- Phase: review
- Observed: the #290 lane's config comment restated the issue's mechanism backwards ("descriptor, not a declaration") at five sites, a claim about parser behaviour written from memory that one stylelint run would have settled; review caught it and the fix touched all five. Counts toward #294 (a claim written before the run that would establish it), as its fifth instance.

## 2026-10-21 — PR #320

- Phase: implementation
- Observed: the #299 lane's per-package test runs were green before `pnpm verify` refused the tree on `max-lines` and the comment-density ratchet, which forced a test-file split and docblock trims after the work was otherwise done; the lane's footprint grew by two test files and a ledger carrier moved with them. Second instance today of the composite gate's size rules arriving after a package's own tests pass (PR #313's lane split its corpus file for the same reason). One ticket so far on the ordering.

## 2026-10-21 — PR #323

- Phase: planning
- Observed: the #311 lane's restatement sweep covered what the gate refuses and not what it exempts, so adding a tokens-directory exemption falsified "`tokens.css` is the one file this gate exempts" at three sites that review found. A fourth sweep shape after the three #293 captured (a change that adds an exemption needs an exemption-claim arm); counts toward #293.

## 2026-10-21 — PR #324

- Phase: implementation
- Observed: the #300 lane's first cut used SQLite's read-only open flag and three repair tests failed, because a read-only connection leaves `-wal` and `-shm` beside the file on close and `rebuildCourse` reads a `-wal` as another connection still holding the file; `PRAGMA query_only` on a normal connection was the fix. One ticket so far on a library flag whose side effect is in the file system rather than in the API. Also the first `REBASE` bounce under `run-issue` step 5's pasted form (PR #310): seven shared files, resolved with no correction from the lane.

## 2026-10-21 — PR #331

- Phase: planning
- Observed: issue #279's body placed the `run-issue` rebase hand-off at "step 4"; PR #310 had renumbered it to step 5 before the lane read it, and the dispatch's overlap note caught it first. Second issue body in one afternoon written by the merge owner with a stale step number (PR #310's lane found the first, in #295); a step number in an issue is a figure that goes stale the moment the skill is edited, so the issue should name the step by its heading or its first words. Counts toward #295's measurement.
