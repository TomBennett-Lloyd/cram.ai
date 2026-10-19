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

## 2026-10-15 — PR #33

- Phase: review
- Observed: three of the seven FIX-NOW findings on #17 were restatement sites of the gate's name or its banned set — `docs/plan.md` still listing `check:no-course-content` as "to add", the missing `.claude/ledgers/` entry, and the `.gitignore` comment — found at review, not at plan time. The ticket-agent lane's plan comment (`.claude/agents/ticket-agent.md` § 2) has no rule-9 sweep step; the planner lane does (`.claude/skills/plan-issue/SKILL.md` step 4). One ticket so far.

## 2026-10-15 — PR #38

- Phase: review
- Observed: issue #30's own sweep regex (`esbuild.{0,80}(vite|vitest|tsx)` and friends) missed a third carrier of the "vite brings esbuild" claim, `verify-tier.test.sh`'s header "it arrives with vite", because that line never says "esbuild". The reviewer's broader patterns caught it, and the lane banked them in `.claude/ledgers/esbuild-provenance.ledger`. Second sweep-shaped miss today (PR #33's entry is the first): a sweep built from the claim's keyword misses paraphrases of the claim.

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
