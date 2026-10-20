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
