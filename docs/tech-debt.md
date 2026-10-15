# Tech-debt log

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13 (header only; cumulo's entries and redirect rows were not carried over). Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

A **buffer, not an archive**. `/review-loop` appends SYSTEMIC findings here instead of iterating on them; `/triage` periodically clusters entries, files root-cause GitHub issues, and **deletes** what it captured. A long-lived entry here means triage is overdue.

Entry format:

```
## YYYY-MM-DD — short title
- Where: file/module references
- What: the pattern or problem (symptom AND suspected root cause if known)
- Source: PR/issue #
```

A dated `- Update` bullet appended to an entry follows the `- Update` sentence of `docs/standards/architecture.md` rule 9.

**Restatement ledger for this file's own path** (`docs/standards/architecture.md` rule 9), which acquired one the first time a site carried it **executably**. A FLOOR, NOT A CENSUS, in both halves. The executable carriers known at porting are two, both added in cumulo by cumulo#513 and carried over with the ported tooling: the `TECH_DEBT_PATH` constant in `.claude/scripts/merge-pr.sh`, whose union step matches this exact path to decide whether a merge conflict is the append collision it may resolve, and the `TD` constant in `.claude/scripts/merge-pr.test.sh`, which is what the cases for that step assert against. Both fail quiet-and-closed rather than quiet-and-open — a renamed log stops conflicting under the old name, `git merge-tree` reports the new one, and the conflicted-set test refuses naming it.

The prose carriers are deliberately **not enumerated here**, because a list nobody has classified is worse than no list: it reads as a census and is one wrong entry away from sending a rename past the site it missed. The census is the sweep, and a rename runs it rather than trusting anything written down — `git grep -ln 'tech-debt\.md' -- ':/'`, which cannot see a paraphrase ("the tech-debt log") at all. Past-tense narration of what a specific ticket did is permitted by rule 9 and a rename leaves it standing; separating those hits from the live carriers is the renamer's job.

Pointers must survive unrelated edits: cite **files and symbol or section names** (function names, headings, config keys, script names) — never bare line numbers, and never a copied code literal unless the literal itself is the finding. An entry that pins its claim to `file.sh`:42 sends its reader to whatever happens to sit at line 42 months later.

---

## Captured-entry redirects

Source comments across the repo cite entries by title ("recorded in `docs/tech-debt.md` (…)"). Triage deletes the entry but cannot edit those comments without turning a docs-only PR into a source-code one, so this table is where a dangling pointer lands. It is a **redirect, not an archive** — the content lives on the issue.

Maintenance: a row dies with its issue; whoever closes the issue deletes the row.

**Resolving a conflict here after a pruning pass**: take `main`'s pruned file as the base and re-apply only your branch's own additions — a union of **changes**, never a union of lines, because a line-union silently resurrects everything just deleted. A deletion on either side is authoritative and is never reinstated. Capture the heading and redirect-row sets of base, main and branch **before** rebasing and the resolution becomes arithmetic rather than judgement; `review-loop` step 5 states the full procedure.

| Captured entry | Now owned by |
| -------------- | ------------ |

---

## 2026-10-14 — "never reaches the screen" wording predates the withheld panel

- Where: `README.md` ("a sentence with no supporting slide never reaches the screen"), `docs/plan.md` §0 ("deleted before the student sees it")
- What: both predate `docs/standards/grounding.md` rule 7, under which a withheld unit's text is shown in the withheld panel, marked withheld and never rendered as an answer. The sentences are true of answers and false of the panel; `plan.md` §0 follows the README's wording.
- Source: #1 review cycle 2

## 2026-10-14 — plan.md §3.5 feature flows skip resolve and report

- Where: `docs/plan.md` §3.5 (Ask, Notes, Exam paragraphs)
- What: Ask reads "generate units → verify → render" and Notes "generate an outline whose every bullet is a unit → verify → render", omitting the resolve and report stages `docs/standards/grounding.md` rule 2 fixes; the exam flow ends "drop any question whose gold answer or rubric fails" with no withheld report. They were drafted before the standard. The fix is each feature ticket's (Ask: #13; notes: M3; exams: M4) rather than a plan edit, since the plan's flows are superseded by the standard the moment a feature lands; question stems as units are #24's.
- Source: #1 review cycle 2

## 2026-10-14 — ADR 0001 (d) ledger sweep has no citation arm

- Where: `docs/adr/0001-grounding-architecture.md` § Decision (d), the restatement-ledger sentence
- What: `docs/standards/architecture.md` rule 9 wants a ledger's sweep to carry a citation arm (`0001-grounding-architecture.md` § Decision (d)) beside the literal arm. No carrier is missed today; add the arm when the ledger moves to the declared `.claude/ledgers/` form at the first value move.
- Source: #1 review cycle 2

## 2026-10-15 — merge-pr.sh member loop expands pr_commits unguarded

- Where: `.claude/scripts/merge-pr.sh`, classify step, the `other_member` loop (`for m in "${pr_commits[@]}"`)
- What: under bash 3.2 with `set -u`, an empty `pr_commits` faults with "unbound variable" inside that loop. A PR always has a commit, so the branch is unreachable, and the fault fails closed before any merge step. The guard `[ "${#pr_closes[@]}" -gt 1 ]` should also require `"${#pr_commits[@]}" -gt 0`, the same class of fault #27 fixed for `pr_closes`.
- Source: PR #28 confirmation pass

## 2026-10-15 — verify-tier.sh's rung 2 claims verify:full's leg order and does not keep it

- Where: `.claude/scripts/verify-tier.sh` — the RUNG 2 header ("The legs are emitted in `verify:full`'s own order") against `build_source_prose_legs`
- What: `build_source_prose_legs` appends `check:ledgers` before `check:adr-index` and the observing tests after every `check:*` leg, while `verify:full` in `package.json` runs `test`, then `check:adr-index`, then `check:ledgers`. A red under rung 2 can therefore stop at a different leg than the composite would. Either reorder the builder or delete the claim.
- Source: #17 review (found while adding `check:no-course-content` to the `.md`-conditional legs; pre-existing on main)

## 2026-10-15 — rule 9's recorded sweep commit is the parent of the swept tree

- Where: `docs/standards/architecture.md` rule 9, the sentence on a ledger not yet declared ("records the commit it was run at (`git rev-parse --short HEAD`)")
- What: a sweep run before the commit that carries its ledger sentence records that commit's parent. It happened (shown at `9d90f16`, whose ledger lists the `docs/adr/README.md` § Index row that is absent at its recorded `5a5f86c`) on ADR 0001 (`bb8a720`) and ADR 0002 (`5a5f86c`, then `9d90f16`, then `15c9b94`). Fix candidates: record the commit after committing (a two-commit dance), or phrase the recipe as "the parent commit of the change that carries this sentence".
- Source: #2 review cycle 1

## 2026-10-15 — architecture.md § Why paraphrases ADR 0002's count without citing it

- Where: `docs/standards/architecture.md` § Why, first sentence
- What: ported cumulo wording that restates ADR 0002 § Decision (a)'s count in the plural and does not cite it. Banked in ADR 0002's restatement ledger under (g).
- Source: #2 review cycle 1

## 2026-10-15 — check:no-network-egress's `--depth Infinity` is pinned by no test

- Where: `.claude/scripts/check-no-network-egress.sh`, the `pnpm ls` invocation; `.claude/scripts/check-no-network-egress.test.sh`, the no-argument real-repo case
- What: the harness reaches the shipped `pnpm ls` call only through the real tree, whose production dependencies have no dependencies of their own today, so a `--depth 0` mutant passes every case and would scan top-level packages only. Pin it once the first production dependency with transitive dependencies lands: assert the real-repo census exceeds the declared count, or assert the invocation.
- Source: #18 review

## 2026-10-15 — declared ledgers' sweeps carry no owner-citation arm

- Where: the `course-content-patterns` and `contradiction-set-bar` ledgers under `.claude/ledgers/`, their `sweep:` lines; the `docs/plan.md` carriers of the latter
- What: `docs/standards/architecture.md` rule 9 says a carrier cites the owner by name and the sweep's first arm is that citation. Both ledgers sweep the literal only, and `docs/plan.md`'s §4 metrics line and §7 item 5 restate the contradiction-set bar without citing `CLAUDE.md` § Hard constraints. No carrier is missed today (the #18 review's synonym sweep found none outside the lists); a paraphrase that drops the literal would be.
- Source: #18 review
