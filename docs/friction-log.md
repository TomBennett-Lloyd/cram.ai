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
