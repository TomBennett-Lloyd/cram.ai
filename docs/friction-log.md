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

## 2026-10-19 — PR #67

- Phase: implementation
- Observed: the #3 lane mutated an uncommitted ledger to check the harness went red, then undid the mutant with `git checkout --`, which also discarded the carrier line it had just added; it re-added the line and re-checked before committing. `docs/standards/testing.md` rule 8 forbids exactly that revert, and `.claude/agents/ticket-agent.md` § 4 cites rule 8 for the mutant loop; the lane was mutating a ledger, not a test, so nothing in the standards index pointed it at the rule. One ticket so far.

## 2026-10-20 — PR #82

- Phase: review
- Observed: the eval course's audit catches a `mustNotContain` entry that appears literally in the deck's own text, but not one that a correct answer _negating_ the slide would trip (the first cycle-1 finding, with three more questions missing a citation to a slide that repeats the answer); the audit's arm is literal, the defect was semantic, and only a reader caught it. One ticket so far; #47's runner is the first consumer that could surface it mechanically.

## 2026-10-20 — PR #86

- Phase: process
- Observed: the merge owner's dispatch for #36 named a precedent ("PR #51") that was wrong (the row came from #2, PR #41), and the lane reused it unchecked in its first commit message and plan comment; the reviewer caught it. `.claude/skills/run-issue/SKILL.md`'s ticket-agent lane dispatches with the issue number, the checkout path, the budget mode and the overlap note "and nothing else"; the extra context paragraph is where the false claim rode in. One instance.

## 2026-10-20 — PR #89

- Phase: planning
- Observed: the #80 plan claimed `eval/src` would pass the comment-density gate once covered, on the strength of a pre-plan run that measured the old scope (16 files, `eval/` excluded); the widened gate put two files over the median and added a docblock cut to the scope mid-flight. A claim about a widened gate needs the widened gate run first. One ticket so far.

## 2026-10-20 — PR #101

- Phase: planning
- Observed: the first lane to run under `.claude/agents/ticket-agent.md` § 2's new sweep sentence (#87) found a carrier its issue did not name — `task-orchestrator.md` rule 1's reconcile range, which PR #96's narrower sweep had missed — and declared it as a footprint change before the first edit. No new signal; recorded so the next graduation check can see the rule's first catch.

## 2026-10-20 — PR #81

- Phase: implementation
- Observed: a new package forces `pnpm verify`'s full tier (about 3 min a run), and the #12 lane edited its tree during a backgrounded run twice, once for a prose-only change; both runs were invalidated and re-run. The cost is the tier's length, not the edit: a lane with three minutes to wait fills them. One ticket so far.

## 2026-10-20 — PR #102

- Phase: planning
- Observed: the #92 lane's plan comment said "Divergence: none" above a paragraph that described one; putting it right cost two fetch-modify-push edits of the comment and a review finding. The summary line was written before the paragraph it summarises. One ticket so far.

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

## 2026-10-20 — PR #132

- Phase: implementation
- Observed: two findings from the #66 lane's own probes, neither caught by a gate. The tokenizers library turns an empty pair member into no pair (`text_pair || null`), which the load probe's `('', '')` input exposed, so the adapter now applies the pair template itself. And the feed-filter guard has no killable mutant on onnxruntime-node, which ignores feeds the model does not declare; the filter stays because the plan specified it, and the PR body declares the surviving mutant. One ticket so far on a guard whose only evidence is a dependency's documented behaviour.

## 2026-10-20 — PR #144

- Phase: process
- Observed: `verify-tier.sh` labelled the #129 change, an interface deleted and a return type renamed across two `.ts` files, "source-prose, 2 file(s) proven comment-only"; typecheck ran on every package regardless, so nothing went unchecked, but the tier's name misdescribes a type-only change and a reader of the verify log would believe only prose moved. One ticket so far.

## 2026-10-20 — PR #120

- Phase: process
- Observed: ADR 0006 waited for the owner's review while three PRs merged under it (#137, #128, #116), and those made stated facts in its § Context, one assumption check and its ledger false; nothing flagged that until the FILL bounce read the ADR against the new main, which cost a REBASE round with Context true-ups. The decisions were untouched, but an ADR under review has no gate that re-checks its Context claims against main. One ticket so far; `merge.approvedAtPlanRule` (#150) names such a true-up as an extra, which surfaces it without preventing it.

## 2026-10-20 — PR #143

- Phase: review
- Observed: the #114 lane's README edit reordered a sentence so that a colon introduced the wrong example, a reorder caught by review; and its rebase union of `docs/review-feedback.md` was the first of six that evening, as every humanAlways PR's fill rewrote its own entry on main while the others waited. The review log is an append-only union at merge time by rule, but a fill edits an existing entry in place, which is what makes each later branch DIRTY rather than BEHIND. One ticket's entry; the shape recurred on PRs #106, #156, #174 and #175 the same evening.

## 2026-10-21 — PR #167

- Phase: implementation
- Observed: the #20 lane's first live `models:pull` run and its mutant run both preceded the last review edits to the script and harness, so both were redone after review (one cold-path reinstall of a 2.5 GB download, one mutant run). The lane's order was build, measure, review, fix; the fix invalidated the measurement. One ticket so far on measuring before review on a script whose review changes its behaviour.

## 2026-10-21 — PR #177

- Phase: process
- Observed: the rule PR #177 adds was written and merged within two hours of the #159 lane raising an unsanctioned macOS automation prompt (`.claude/agents/ticket-agent.md` § 5 (g)), and the #159 lane itself stopped cleanly on a HOLD, deleted what it had created and reported its probe findings with provenance. No new signal; recorded so the rule's first catch, if any, has its origin dated.

## 2026-10-21 — PR #193

- Phase: implementation
- Observed: the #109 lane's first mutation harness decided "survived" by reading vitest's last lines for the word "failed" and reported two false survivors; rerun on the exit code, both mutants were dead. `docs/standards/evidence.md` already makes the captured exit code the verdict for `pnpm verify`; the mutant harness a lane writes for itself is the same shape and is not named there. One ticket so far.

## 2026-10-21 — PR #197

- Phase: implementation
- Observed: the time-box red that #152 recorded at load average 90–100 did not reproduce for its lane at load averages of 41 to 76 on 10 cores (three runs of three green; a bare stub call measured 42 ms at most), so the lane removed the race rather than tuning a margin, with a regression case that fails on the pre-fix harness. A load-dependent red that cannot be reproduced on demand is fixed by construction or not at all; the lane's answer was the right one. One ticket so far.

## 2026-10-21 — PR #158

- Phase: process
- Observed: main moved four times during the #133 lane's single REBASE bounce, and each move cost it either a tech-debt union or a stale citation: ADR 0006 went from proposed to accepted under it, and the triage pass (#191) deleted two tech-debt entries its code cited by title, one with no redirect row, because the pass grepped for citations of `tech-debt.md` as a path and not for each deleted entry's title. The triage skill says the redirect table is where a dangling pointer lands; it does not say the deleting pass greps every title it deletes. One pass so far.

## 2026-10-21 — PR #215

- Phase: implementation
- Observed: the #16 lane ran `pnpm verify` eleven times, each taking 9 to 15 minutes, while fourteen to sixteen lanes shared the machine at a load average of 90 to 100; one run was a re-run after #152's time-box signature (fixed since by PR #197). The lane's work (86 files, four review passes, a browser-smoke pass) was not the cost; the verify runs were, and most of that was waiting on the other lanes' runs. The parallelism bought wall-clock across tickets and paid it back inside each. One lane's figures so far; the effort pilot (#140) records tokens and duration per lane and is where the trade-off becomes visible.

## 2026-10-21 — PR #222

- Phase: implementation
- Observed: the #146 lane's local browser lane failed `apps/web/e2e/focus.spec.ts` ("a keyboard reader sees the ring on a slide card") on three runs of three with the element reported inactive, and read it as the browser window not being frontmost. PR #232 (#228) then showed the cause was a race in the test: it pressed Tab before the answer rendered, so focus left the page; Playwright's `toBeFocused` reports `inactive` both for a wrong active element and for a document without focus, so the message could not tell the two apart. Recorded as the first reading and its correction, because the first reading reached a dispatch note before it was tested.

## 2026-10-21 — PR #224

- Phase: planning
- Observed: the #145 lane's planning sweep covered `main` only, so it did not see that open PR #214 (#134) builds the same live gateway in `eval/src/live-gateway.ts`; it found that through an issue search partway through the lane. The dispatch note names in-flight lanes by footprint, and `.claude/agents/ticket-agent.md` § 2's sweep runs over the tree, so an open PR's duplicate of a planned helper is visible only to whoever greps the open branches. One ticket so far; #223 holds the merge of the two assemblies.

## 2026-10-21 — PR #235

- Phase: process
- Observed: `merge-pr.sh`'s first run on PR #222 and again on PR #232 exited 1 without merging, and the idempotent re-run merged each at once. Both times the first run had just done `gh pr update-branch` and polled the new head's checks within the 540 s the caller allowed, while CI runs were taking three to four minutes to queue under the evening's load; the second run found the checks complete. Two merges so far; the poll budget is the caller's environment variable, not the script's, so this is a merge-owner habit to measure before it is a script change.
