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

## 2026-10-15 — PR #38

- Phase: review
- Observed: issue #30's own sweep regex (`esbuild.{0,80}(vite|vitest|tsx)` and friends) missed a third carrier of the "vite brings esbuild" claim, `verify-tier.test.sh`'s header "it arrives with vite", because that line never says "esbuild". The reviewer's broader patterns caught it, and the lane banked them in `.claude/ledgers/esbuild-provenance.ledger`. Second sweep-shaped miss today (the first was PR #33's entry, consumed by #87): a sweep built from the claim's keyword misses paraphrases of the claim.

## 2026-10-16 — PR #48

- Phase: process
- Observed: on retrying a stuck `merge-pr.sh 48`, the merge owner's `pgrep -f 'merge-pr.sh 48'` guard matched the shell running the guard itself. (The stuck poll this entry first recorded is now issue #55's, and the ADR-path cost is #49's and #50's.)

## 2026-10-19 — PR #67

- Phase: implementation
- Observed: the #3 lane mutated an uncommitted ledger to check the harness went red, then undid the mutant with `git checkout --`, which also discarded the carrier line it had just added; it re-added the line and re-checked before committing. `docs/standards/testing.md` rule 8 forbids exactly that revert, and `.claude/agents/ticket-agent.md` § 4 cites rule 8 for the mutant loop; the lane was mutating a ledger, not a test, so nothing in the standards index pointed it at the rule. One ticket so far.

## 2026-10-19 — PR #73

- Phase: implementation
- Observed: the comment-density ratchet's median was computed over 7 baseline rows (20.68%), so a four-line file holding one docblock measured 25% and read as over; the #11 lane folded `source-id.ts` into `slide-row.ts` to pass, and then declined to bank its nine new files' rows because below-median rows would lower the bar every other lane is judged against. The policy question is in `docs/tech-debt.md`; the friction is that a small baseline makes the ratchet shape files rather than comments.

## 2026-10-20 — PR #82

- Phase: review
- Observed: the eval course's audit catches a `mustNotContain` entry that appears literally in the deck's own text, but not one that a correct answer _negating_ the slide would trip (the first cycle-1 finding, with three more questions missing a citation to a slide that repeats the answer); the audit's arm is literal, the defect was semantic, and only a reader caught it. One ticket so far; #47's runner is the first consumer that could surface it mechanically.

## 2026-10-20 — PR #86

- Phase: process
- Observed: the merge owner's dispatch for #36 named a precedent ("PR #51") that was wrong (the row came from #2, PR #41), and the lane reused it unchecked in its first commit message and plan comment; the reviewer caught it. `.claude/skills/run-issue/SKILL.md`'s ticket-agent lane dispatches with the issue number, the checkout path, the budget mode and the overlap note "and nothing else"; the extra context paragraph is where the false claim rode in. One instance.

## 2026-10-20 — PR #89

- Phase: planning
- Observed: the #80 plan claimed `eval/src` would pass the comment-density gate once covered, on the strength of a pre-plan run that measured the old scope (16 files, `eval/` excluded); the widened gate put two files over the median and added a docblock cut to the scope mid-flight. A claim about a widened gate needs the widened gate run first. One ticket so far.

## 2026-10-20 — PR #90

- Phase: review
- Observed: the cycle-1 correctness finding on #70 was a guard that did not exist — a rebuild silently dropped any slide whose lecture had no stored deck. The pre-review mutation pass (`.claude/agents/ticket-agent.md` § 4) deletes guards that exist and cannot find a missing one; only the reviewer's reading of the invariant did. One ticket so far.

## 2026-10-20 — PR #101

- Phase: planning
- Observed: the first lane to run under `.claude/agents/ticket-agent.md` § 2's new sweep sentence (#87) found a carrier its issue did not name — `task-orchestrator.md` rule 1's reconcile range, which PR #96's narrower sweep had missed — and declared it as a footprint change before the first edit. No new signal; recorded so the next graduation check can see the rule's first catch.

## 2026-10-20 — PR #81

- Phase: implementation
- Observed: a new package forces `pnpm verify`'s full tier (about 3 min a run), and the #12 lane edited its tree during a backgrounded run twice, once for a prose-only change; both runs were invalidated and re-run. The cost is the tier's length, not the edit: a lane with three minutes to wait fills them. One ticket so far.

## 2026-10-20 — PR #102

- Phase: planning
- Observed: the #92 lane's plan comment said "Divergence: none" above a paragraph that described one; putting it right cost two fetch-modify-push edits of the comment and a review finding. The summary line was written before the paragraph it summarises. One ticket so far.

## 2026-10-20 — PR #83

- Phase: review
- Observed: the #9 lane's pre-review mutation pass (`.claude/agents/ticket-agent.md` § 4) called the PDF adapter's rethrow arm unreachable because no synthetic input reached it; the reviewer reached it with a broken page tree. An unreachability claim quantifies over every input, and the pass had tried only the fixtures it held. Second entry today on that pass's evidence being bounded by its own inputs (PR #90's was a guard it could not see because the guard did not exist).

## 2026-10-20 — PR #116

- Phase: implementation
- Observed: the #93 lane wrote `Map.groupBy` into a test fixture; it is ES2024 and the base tsconfig's `lib` is ES2023, so `tsc` refused it before any test ran and the fixture groups by hand. The gate did its job at no cost; recorded because the `lib` ceiling is a value an implementer meets only by hitting it. One ticket so far.

## 2026-10-20 — PR #123

- Phase: planning
- Observed: the #79 plan chose `@napi-rs/canvas` as a devDependency of `eval/` on the reasoning that devDependencies are outside `check:no-network-egress`'s scan. Adding it anywhere in the workspace satisfied `unpdf`'s optional peer, so pnpm re-resolved `@cram/ingest`'s production `unpdf` against it and the gate flagged the Skia binary in ingest's production tree. The lane switched to `jimp` (pure JS, no peer coupling) and re-planned once. A devDependency can change another importer's production tree through optional-peer resolution; only the gate saw it. One ticket so far.

## 2026-10-20 — PR #128

- Phase: review
- Observed: the #10 lane's mutation pass recorded the `sizeOf` `0` floor as an equivalent mutant, and the reviewer killed it with a second input shape: a paragraph with no `a:rPr` and one whose `a:rPr` has no `sz` read differently once the floor is gone. `.claude/agents/ticket-agent.md` § 4 asks for one mutant per guard edge; it does not say what earns the label "equivalent", and this one was earned by one input shape. One ticket so far.

## 2026-10-20 — PR #139

- Phase: planning
- Observed: the #40 lane's own plan-comment sweep, written `git grep -E … P\b`, dropped four hits that `-P` returns, which is the defect the ticket was fixing; the lane noticed only because one expected hit (`check-ledgers.sh:254`) was missing from the output. A sweep's output is read for what it contains, not for what it should contain, so a dead arm is invisible unless a known hit is absent. `docs/standards/evidence.md` member 10 now names the fixture; one ticket so far on the reading habit.

## 2026-10-20 — PR #137

- Phase: review
- Observed: the #78 lane's first commit filtered references slides with one shared `rowid in` clause, which made the FTS5 word search re-run its match once per id, 165 times slower at 3000 slides, and `pnpm verify` stayed green because the retrieval timing test runs only under `CRAM_MEASURE=1`. The reviewer's manual measured run caught it, and #136 now asks what gates a retrieval query-plan or latency regression. One ticket so far; the RESUME after the lane's rate-limit death redid nothing, which is recorded here as the recovery path working rather than as friction.

## 2026-10-20 — PR #118

- Phase: planning
- Observed: issue #57 ended "Decision needed (owner)", and the lane answered the question from the repo's documents instead of stopping BLOCKED, leaving a "Contrary reading" paragraph for the merge owner; the merge owner held the PR for the owner's word, which came a few hours later and agreed. The #56 and #47 lanes, given owner-shaped questions the same day, stopped at the plan. `.claude/agents/ticket-agent.md` § 5 (d) names "owner taste" as a stop trigger and says nothing about an issue that labels its own question as the owner's. One ticket so far on the lane deciding; the reviewer's pathspec finding (an edge no guard-edge mutant named) is the same shape as PR #83's entry.

## 2026-10-20 — PR #132

- Phase: implementation
- Observed: two findings from the #66 lane's own probes, neither caught by a gate. The tokenizers library turns an empty pair member into no pair (`text_pair || null`), which the load probe's `('', '')` input exposed, so the adapter now applies the pair template itself. And the feed-filter guard has no killable mutant on onnxruntime-node, which ignores feeds the model does not declare; the filter stays because the plan specified it, and the PR body declares the surviving mutant. One ticket so far on a guard whose only evidence is a dependency's documented behaviour.

## 2026-10-20 — PR #144

- Phase: process
- Observed: `verify-tier.sh` labelled the #129 change, an interface deleted and a return type renamed across two `.ts` files, "source-prose, 2 file(s) proven comment-only"; typecheck ran on every package regardless, so nothing went unchecked, but the tier's name misdescribes a type-only change and a reader of the verify log would believe only prose moved. One ticket so far.

## 2026-10-20 — PR #154

- Phase: review
- Observed: the #15 server's two mutant passes (the first lane's, then the resumed lane's 47 mutants, which found 9 unprotected guard edges the first had missed) still left two defects for the reviewer: an untested deck byte cap, and a request target such as `GET http://[` parsed outside the request boundary, which killed the whole server process. Neither was framed as a guard edge, so no mutant named it. Third entry today on the mutation pass's evidence being bounded by the edges its author listed (PR #83, PR #128 before it); the reviewer's reading of the invariant is still what finds the rest.

## 2026-10-20 — PR #120

- Phase: process
- Observed: ADR 0006 waited for the owner's review while three PRs merged under it (#137, #128, #116), and those made stated facts in its § Context, one assumption check and its ledger false; nothing flagged that until the FILL bounce read the ADR against the new main, which cost a REBASE round with Context true-ups. The decisions were untouched, but an ADR under review has no gate that re-checks its Context claims against main. One ticket so far; `merge.approvedAtPlanRule` (#150) names such a true-up as an extra, which surfaces it without preventing it.

## 2026-10-20 — PR #160

- Phase: implementation
- Observed: the #126 lane's mutant pass covered the operand-versus-argument sites it had listed (nary, func, rad), and review found seven more operand sites it had not; the lane's own words were that listing edges by construct rather than by the sites already reasoned about would have caught them. Fourth entry today on the mutation pass's coverage being bounded by its author's list (PR #83, PR #128, PR #154). The lane also decided the issue's two "To decide" items itself, the second instance of PR #118's shape; both were ingest-internal, with no prompt or resolver change, and the merge owner merged on that basis.

## 2026-10-20 — PR #143

- Phase: review
- Observed: the #114 lane's README edit reordered a sentence so that a colon introduced the wrong example, a reorder caught by review; and its rebase union of `docs/review-feedback.md` was the first of six that evening, as every humanAlways PR's fill rewrote its own entry on main while the others waited. The review log is an append-only union at merge time by rule, but a fill edits an existing entry in place, which is what makes each later branch DIRTY rather than BEHIND. One ticket's entry; the shape recurred on PRs #106, #156, #174 and #175 the same evening.

## 2026-10-20 — PR #156

- Phase: process
- Observed: the merge-time verdict fill on PR #156 was refused by the auto-mode permission classifier in the lane ("CI Bypass"), as were the fills on PRs #106 ("Self-Approval", four times) and #143 ("Merge Without Review"), while the identical command ran cleanly in the #132 and #120 lanes. The owner's `fill-verdict.sh` allow rule matched only the bare command form, and the refused lanes had wrapped it in a `cd &&` or a path export. The owner ran the three fills by hand; on #156 the hand-run fill and the lane's REBASE bounce acted on one worktree at once, which the lane noticed and waited out. The bounce text now names the bare form with `--worktree`; whether that is enough is the next fill's measurement.
