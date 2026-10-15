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

## 2026-10-15 — PR #32

- Phase: process
- Observed: on CI run 38810233861 the `gitleaks` check-run sat at status `in_progress` with conclusion `success` and every step completed, so `gh pr checks` showed it pending and `gh pr checks --watch` never exited; the lane read the job through `gh api .../actions/jobs/<id>` instead. `merge-pr.sh` was not caught by it only because `update-branch` moved the head and a fresh run replaced the stuck one. One occurrence.

## 2026-10-15 — PR #38

- Phase: review
- Observed: issue #30's own sweep regex (`esbuild.{0,80}(vite|vitest|tsx)` and friends) missed a third carrier of the "vite brings esbuild" claim, `verify-tier.test.sh`'s header "it arrives with vite", because that line never says "esbuild". The reviewer's broader patterns caught it, and the lane banked them in `.claude/ledgers/esbuild-provenance.ledger`. Second sweep-shaped miss today (PR #33's entry is the first): a sweep built from the claim's keyword misses paraphrases of the claim.
