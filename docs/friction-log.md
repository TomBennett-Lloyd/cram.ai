# Friction log

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13 (header only; cumulo's entries were not carried over)._

Weak signals from `/retro` that don't yet have a clear improvement action — recorded so patterns become visible across tasks ("we churn on X in half of tasks") instead of being forced into premature lessons. `/triage` mines this for repeats (≥3 similar entries, or affecting ≥50% of recent tasks) and converts patterns into workflow issues, deleting captured entries. Singletons stay until they repeat or go stale.

This file's own path has a restatement ledger (`docs/standards/architecture.md` rule 9): `.claude/ledgers/friction-log-path.ledger`, which `check:ledgers` re-runs.

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

## 2026-10-21 — PR #167

- Phase: implementation
- Observed: the #20 lane's first live `models:pull` run and its mutant run both preceded the last review edits to the script and harness, so both were redone after review (one cold-path reinstall of a 2.5 GB download, one mutant run). The lane's order was build, measure, review, fix; the fix invalidated the measurement. One ticket so far on measuring before review on a script whose review changes its behaviour.

## 2026-10-21 — PR #177

- Phase: process
- Observed: the rule PR #177 adds was written and merged within two hours of the #159 lane raising an unsanctioned macOS automation prompt (`.claude/agents/ticket-agent.md` § 5 (g)), and the #159 lane itself stopped cleanly on a HOLD, deleted what it had created and reported its probe findings with provenance. No new signal; recorded so the rule's first catch, if any, has its origin dated.

## 2026-10-21 — PR #248

- Phase: planning
- Observed: the #231 lane's plan comment described its first design (a stub that returned a `holdAsk()` closure) in detail; review replaced it with a named option under `docs/standards/structure.md` rule 2, and the plan comment then cost two confirmation rounds of prose drift, because struck text beside new text read as still live and only rewriting the sections whole passed. One ticket so far on a plan comment that commits to a shape before review has seen it.

## 2026-10-21 — PR #263

- Phase: implementation
- Observed: the #233 plan split the shared `IngestStatus` shape change (step 2) from the web consumer that answers it (step 3), and the lane had to land both in one commit because `pnpm verify` is whole-repo and the web package is red between them. A plan step that changes a shared type is not committable on its own; nothing in `.claude/agents/planner.md` asks whether a step's `Verify:` can pass before its consumers move. One ticket so far.

## 2026-10-21 — PR #291

- Phase: implementation
- Observed: the frontend-gate probe harness compares sets of `line:rule` pairs and merges duplicates, so it cannot see a rule reporting one fault twice; the #280 lane added a counting case for its own rule only. The lane also spent one fix round after removing comment handling on the measurement that postcss strips comments, which holds except for a comment with no whitespace on either side. One ticket so far on each.

## 2026-10-21 — PR #324

- Phase: implementation
- Observed: the #300 lane's first cut used SQLite's read-only open flag and three repair tests failed, because a read-only connection leaves `-wal` and `-shm` beside the file on close and `rebuildCourse` reads a `-wal` as another connection still holding the file; `PRAGMA query_only` on a normal connection was the fix. One ticket so far on a library flag whose side effect is in the file system rather than in the API. Also the first `REBASE` bounce under `run-issue` step 5's pasted form (PR #310): seven shared files, resolved with no correction from the lane.

## 2026-10-21 — PR #336

- Phase: dispatch
- Observed: the #296 lane reported no friction of its own, but its merge made PR #337 (#294) DIRTY on the same `.claude/agents/ticket-agent.md` § 4 paragraph, costing that lane a source-conflict rebase round; a third lane (#293, PR #334) edits § 2 of the same file. The merge owner admitted all three in parallel with the overlap named in each dispatch, pricing it as rebase cost; a same-paragraph edit on an agent definition is same-file SOURCE overlap by `run-issue` step 1's own rule and should have been sequenced or batched at dispatch. One ticket so far on agent-definition edits colliding.

## 2026-10-21 — PR #266

- Phase: implementation
- Observed: the #165 lane mutated the test-exclusion regex but not the line that applies it to the basename, and review found the surviving mutant. The guard's edges include the site that applies the pattern, not only the pattern's arms; second instance of a mutant list stopping at the regex (PR #278's anchoring mutants were the first, now in ticket-agent § 4's axes rule). One ticket so far on the application site.

## 2026-10-21 — PR #351

- Phase: review
- Observed: the #276 lane argued away the plan's untracked-file arm during implementation by reasoning about module resolution, and the reviewer refuted the argument with a shadowing counterexample. An argument for deleting a planned guard needs a mutant shape drawn from the grammar list, not reasoning alone; one ticket so far, and ticket-agent § 4's hostile-corpus rule (PR #336) is the nearest home if it recurs.

## 2026-11-02 — PR #394 (plan counts)

- Phase: planning
- Observed: the #282/#287/#288 batch's plan carried its prototype harness counts (181/211/241 rows) as each chunk's expected baseline and one rule the prototype had settled under bash (`endsPattern` keeping `#`); zsh, the oracle, contradicted the rule, and each implementer added rows past the count (6, 8 and 27) to kill survivors, so every later dispatch had to be told the new baseline by hand. A row count in a plan is a figure the first chunk's edit invalidates; the plan could name the harness and let each chunk report its own. One batch so far.

## 2026-11-02 — PR #394 (curated history)

- Phase: process
- Observed: every review fix on the batch folded into its member's commit by `--fixup` and autosquash (or `--amend` at HEAD), and a fold onto an earlier member conflicted whenever a later member had edited nearby lines; each was resolved by hand at the earlier position with the intermediate tree harness-checked (200 and 246 rows passing), later positions resolved to the known final tree under a tree-equality check, and two message rewords needed an `exec git commit --amend -F` line injected through the sequence editor. Fix rounds ran per member so the folds stayed per member, which serialised them (one #288 round ran about 2.6 h). First batch to merge `--rebase` under the one-commit-per-member rule; the cost is the rule's, recorded so the next batch can price it.

## 2026-11-02 — PR #397 (measuredCommit regex)

- Phase: planning
- Observed: before any edit, the #367 lane measured the issue's two defects through a scratch harness that ran `runEval` (`eval/src/run-eval.ts`) against the live backends, and lost one 6-minute live run because the scratch report's `measuredCommit` failed `EvalReport`'s sha regex in `eval/src/report.ts`. The committed runner derives that value through `eval/src/measured-commit.ts`, which the scratch harness did not go through. The measurement was the right call: it showed neither defect has the cause the issue proposes, which is what stopped the lane (the plan-time stop #433 captured). One lane so far on a scratch harness handing a committed schema a value the runner derives for it.

## 2026-11-02 — PR #397 (footprint)

- Phase: planning
- Observed: the #367 plan's `Files:` list named `packages/grounding/src/slide-text.ts` but not the test its new `slideLines` would need, and named `apps/server/src/server-fixture.ts` "and its callers" and `eval/src/*-fixture.ts` where the diff changed `apps/server/src/ask.test.ts` and `eval/src/run-eval.test.ts` and no fixture; with `docs/tech-debt.md` (the review's one SYSTEMIC finding) and `.claude/comment-density.baseline.tsv`, that is a five-file `Footprint change:` on a 23-file PR. The baseline rows were not owed: the PR adds no scanned source file (its one new `.ts` is a `.test.ts`), so the four lowered rows came from a `--ratchet` run the lane chose, and the lane's Friction line then records that run's cost — a code line shortened after a mid-lane ratchet reads as a rise. One lane so far on each; the ratchet-ordering half is commented on #404.

## 2026-11-02 — PR #425 (sweep PR arm)

- Phase: planning
- Observed: the #366 plan's restatement sweep (`docs/standards/architecture.md` rule 9's recorded form) carried a PR arm over every PR merged since the worktree's base and every open PR; at Revision 5's run (base `fe4a723`) the merged set was #394, #397 and #406 and the open set #407 and #414, and #407 re-pushed and merged during that planner run (lane report, 2026-11-02 12:46Z). By the PR every one of the five was merged, and the PR body re-ran all 25 families at HEAD `ec1cfe9` against `origin/main` at `19c1d95` as the baseline, showing every family's hit set changed only in the twelve files the PR edits. The arm is a snapshot of `main` taken at the start of a planner run, so on an issue whose plan then waits days for the owner it is stale by the time the lane reads it; the HEAD-versus-base re-run is what held. One ticket so far.

## 2026-11-02 — PR #425 (comment cap)

- Phase: planning
- Observed: the #366 plan outgrew one GitHub comment at Revision 3 (lane report: 50,101 characters against the 65,536 cap) once the rule 9 sweep's full hit lists were in it, so the lane repurposed its earlier report comment as a companion directly below the plan and moved the sweep output there, declaring the split a divergence in plan § 4. By Revision 5 the plan read 58,535 characters and the companion 62,257, the companion also holding the § 4 divergences and the § 9 follow-up bodies "for space"; `gh` reads 59,186 and 62,257 after the PROCEED quote was added at the plan's head. `.claude/skills/plan-issue/SKILL.md` step 5 posts one file with `gh issue comment --body-file` and names no cap, and #412's scratch file changes how the plan reaches the comment, not its size. First plan to hit the cap; what filled it was the sweep's recorded form — families A–Y, every hit listed and classified — on a plan that changes the repo's central claim.

## 2026-11-02 — PR #432 (unkillable weight)

- Phase: implementation
- Observed: `TOPIC_LIST_WEIGHT` (`packages/index/src/course-index.ts`) is 1, the unit weight the other two lists carry as a literal, so mutant W1 (the constant → 1) has no input that tells the owned value from the literal, and the lane reported it under the `Mutation:` line's `unkillable` slot with the reason, as `.claude/agents/ticket-agent.md` § 4 asks; the weighting itself died at R4, and the three guards whose mutants also survived were removed as equivalent, each with a second shape named. The value is provisional until #426's measured run (#69), as `RETRIEVAL_K` is, but that one sits off the unit so a mutant can move it; a provisional owned value at its neutral default is held only by its docblock until it is tuned. One ticket so far.

## 2026-11-02 — PR #418 (CI silence)

- Phase: merge
- Observed: PR #418 opened DIRTY on `docs/tech-debt.md` alone after the lane had rebased once onto `0654737` and unioned the log: #407 merged at 12:44:47Z (`19c1d95`), 2 min after the lane's push, touching the log again, and #432 (`f1df348`, 14:58:41Z) touched it once more. `gh pr checks 418` read "no checks reported" throughout, since a conflicted PR has no merge ref. The merge owner took `.claude/skills/run-issue/SKILL.md` step 5's logs-alone arm: `merge-pr.sh`'s union commit `1a2b03f` landed at 15:01:28Z, the five checks completed between 15:02:00Z and 15:08:06Z, and the merge followed at 15:08:13Z, so the PR's first and only CI run was the merge's own. PR #345's retro entry (pruned by the 2026-11-04 triage; its filing half is now #615) priced each log-only `REBASE —` bounce at a lane round and a CI run and named the union as the saving; this is the union's side of the price — a DIRTY-on-logs PR shows no CI verdict until the merge owner commits to merging it, and the lane's own re-clear bought a 2 min head start. PR #394's and PR #407's lanes record no CI-silent wait (PR #407's lane report reads `CI: green`); first instance recorded.

## 2026-11-02 — PR #418 (M8 re-run)

- Phase: implementation
- Observed: the #408 lane's mutant M8 (record the sha at classify, not at the ready verdict) was three edits, and its first run under a `408-mut-M8-*` name applied a copy of M7's edit instead; the lane caught it, re-ran it as `M8b`, and the PR body's table and the lane report's `wasted work` both say so. The cost was one run of the nine-case scratch harness the lane built because the committed one takes ~2 min a run (#434). `docs/standards/testing.md` rule 8's loop is apply, run the one test file, revert by the inverse edit; nothing in it checks that the edit applied is the mutant named, and a hand-applied multi-edit mutant is where that shows. One lane so far.

## 2026-11-02 — PR #455 (plan file)

- Phase: planning
- Observed: the #410/#411/#412/#427 batch's planner (Fable, budget mode `normal`; 179k tokens, 30 tool uses and about 14.5 min by the orchestrator's round notes) wrote its plan to `plan-410.md` by Bash heredoc and named the path on its first line — #412's rule, applied before #412 merged, which it did in this same PR as `0774cb9` — and the orchestrator posted that file with `gh issue comment --body-file`: 39,780 characters by `gh api`, re-typed nowhere. #412 (from PR #394's retro) is the cost it removed (about 20k characters re-typed into a file). First use of the rule, one batch so far; recorded so a later graduation check can date it.

## 2026-11-02 — PR #455 (humanAlways drop)

- Phase: planning
- Observed: #411 left the batch at the plan checkpoint because the planner's `docs/standards/architecture.md` rule 9 sweep for its route found `CLAUDE.md:55` ("Systemic findings go to `docs/tech-debt.md`, not into endless iteration") as an unqualified restatement, and `CLAUDE.md` is `humanAlways`, which a batch never carries (`.claude/workflow.json` → `orchestration.routeRule`; `.claude/agents/task-orchestrator.md` rule 7's drop at the checkpoint). The issue body named the skill's `description` line as a carrier and not `CLAUDE.md`, so admission's composition test (`.claude/skills/run-issue/SKILL.md` batch lane step 2, "no expected humanAlways paths"), which predicts from the issue body, predicted none; the orchestrator had applied `planned` to #411 before the strike and removed it. The cost was small — C2's text stands as #411's starting plan and #411 runs as its own ticket-agent lane (open) — and the first grep of `CLAUDE.md` for the route's wording was the planner's. Counts with #433's three plan-time stops (#367, #393, #369) as a fourth plan that found a file its issue did not name, of a different kind: those were ADR Decision points, and #449's dispatch-time read (PR #449, open and unmerged at this retro) reads each acceptance bullet against the ADRs `docs/adr/README.md` § Index lists, owning a bullet "when satisfying it would edit a file under `docs/adr/**`" — `CLAUDE.md:55` is outside that read, so it would not have caught this one.

## 2026-11-02 — PR #455 (plan-text findings)

- Phase: review
- Observed: the reviewer's cycle 1 returned 10 FIX-NOW, and the handover places every one in the rule text the plan specified and the implementers (Opus, all `DONE` first time) applied as written: a guard-only count under a "parser or guard" scope, "never re-typed" beside its own fallback, a `head -1` check that cannot see the contest it claims to, rule 1 pulling rule 8's BLOCKED consequence into itself, copies of the owned `plan-<n>.md` literal, three bare-form restatements, a quoted field that does not exist, a duplicated sentence, and #447 (the duplicate #615 now records). Cycle 2 found one FIX-NOW the cycle-1 fix introduced and cycle 3 approved — 3/3 of `.claude/skills/review-loop/SKILL.md`'s cap, no confirmation pass. On a batch whose chunks are rule text the plan's text is the diff's text, so the review loop was the plan's review; `.claude/skills/plan-issue/SKILL.md` step 4 reads a plan for executability (real files, checkable acceptance, a DAG, sweeps with controls, mutants that bite, literal code that cleared the gate) and nothing there reads a rule's text against the rule beside it, which is what cycle 1 did. Counts with the `PR #248` entry (a plan comment committing to a shape before review had seen it) as the second where review's object was the plan, and the first batch where the plan was the whole diff.

## 2026-11-02 — PR #443 (report channel)

- Phase: process
- Observed: PR #443's `## Lane report` was last edited at 17:20:29Z (`userContentEdits`), the report at head `c06b01c` reading "still owed: CI green at c06b01c, then the awaiting-review label" and "branch BEHIND main by docs-only 7345e00"; the lane then committed `63e003f` (17:33:40Z, its merge of `7345e00`) and the FILL's verdict `6534123` (18:25:50Z), and the body was refreshed for neither, though `.claude/agents/ticket-agent.md` § 8 says a bounce round, `FILL` included, ends in a refreshed report posted where it outlives the lane. The merge owner's retro brief records the lane instead re-sending its report to the top level while parked under `awaiting-review` (labelled 17:25:47Z, merged 18:38:31Z) with nothing new in it, until the merge owner acknowledged it, and reads the loop as the lane resuming on each notification. The durable copy at merge therefore names a head two lane commits behind the one that merged, and the chat copies carried what the body did not. One lane so far on the two copies diverging in that direction; PR #418's hand-back (pruned by the 2026-11-04 triage as stale under `.claude/agents/ticket-agent.md`'s report-once rule, #523) is the body going stale the other way, with no chat copy at all.

## 2026-11-02 — PR #449 (fixes at cap)

- Phase: review
- Observed: the batch's review ran 3 cycles with FIX-NOW counts 6, 2 and 1, then a confirmation APPROVE, and cycles 2 and 3 each found that the previous cycle's fix text asserted behaviour no agent file provides — a mid-run `REBASE —` bounce, then a pre-report rebase (cycle 3 found one of cycle 2's own fixes doing the same). The orchestrator's prose fixes, written at cap pressure, minted false claims faster than they closed them; the move that converged was deleting the claim and citing #448, the `discovered` issue that owns the missing entry. The `cumulo#398` lesson in `.claude/skills/review-loop/SKILL.md`'s exit conditions names this shape for derived figures ("delete the derived figures rather than track them"); here the derived thing was a promised mechanism. One batch so far on a merge-owner rule whose fixes promise what no lane implements.

## 2026-11-02 — PR #445 (union at merge)

- Phase: merge
- Observed: the branch went DIRTY on `docs/review-feedback.md` alone. `main` gained #395's entry in `2cfea7e` (18:38:30Z) after the branch base `f69d224`. The lane's report ran a trial union locally and did not push it. `.claude/scripts/merge-pr.sh`'s union step committed `e20a771` on the branch at 19:13:59Z, and the squash `d8180fd` followed at 19:20:20Z, with no bounce (the merge owner's retro brief). `git show <c>:docs/review-feedback.md | grep -c '^## '`, which also counts the file's four non-entry headings, reads 44 at `f69d224`, 45 at `4f8e6e4`, 45 at main `4fa0840`, and 46 at `e20a771` and `d8180fd`. That matches the lane's trial ("result 46"). The merge owner's retro brief gives the result as 45, a figure the tree does not bear out, and that count is noted on #295. No new signal. Recorded so that a later count of union-at-merge outcomes includes this one.

## 2026-11-02 — PR #450 (sweep neighbour clause)

- Phase: review
- Observed: the #424 plan's sweep family 2 listed `README.md:5` (its positive control) and `docs/plan.md:9` and classified both "moves"; the lane's rewrite of each kept an interpretation "unless one contradicts it" (`64351b0:README.md` line 5), and the full review pass's FIX-NOW restored #420's amendment that an entailing slide wins (`bd64261`). The plan comment records this as "Missed in the first pass" and the lane's Friction line as the sweep missing two sites; the sites were in the sweep's output, and what was missed was the new text, which restated a neighbouring clause of the same sentence — #420's rule, not the one #424 changed — that no family searched for. The clause the rewrite used is the one `CLAUDE.md:11` still carries ("an interpretation is withheld if one contradicts it"), the humanAlways hit the sweep classified "stands". The review's SYSTEMIC finding (PR #450, now #491) names the root cause; #458 (open) checks how a sweep classifies the hits it leaves, not what it writes at the hits it edits. One ticket so far.

## 2026-11-02 — PR #454 (post-fill commit)

- Phase: merge
- Observed: the verdict commit `71362d1` (`approved-no-changes`, quoting "approve 454 and 445") came before `43f10c3`, so the merged head carried a ledger line the owner's approval had not seen. The merge owner's retro brief records the decision to merge on the existing approval because `43f10c3` touched no humanAlways path. Then came `gh pr update-branch` (`a68637b`, 19:45:13Z), run 41512855963 green at 19:50:25Z, and the squash `f7168ab` at 19:50:34Z. `.claude/workflow.json` → `merge.mergeRitual` orders fill, merge, label, and names no arm for a lane commit between the fill and the merge. `merge-pr.sh`'s feedback step reads the branch's added `docs/review-feedback.md` lines for a filled entry, not which head the fill preceded. #416, on the humanAlways list being read at classify rather than for the merging head, is the nearest open issue. The judgement held here (a non-humanAlways commit after the fill rides the approval), and no text states it. One PR so far.

## 2026-11-02 — PR #454 (dispatch refusal)

- Phase: process
- Observed: #440 was filed at 16:15:13Z, and 28 s later its first comment recorded the merge owner's auto-mode classifier refusing the lane's dispatch as self-modification, since the footprint was the session's own permission settings and `.claude/workflow.json`. On the owner's explicit word it was re-dispatched, and the plan comment went up at 16:21:34Z. The cost was about six minutes and an owner message. `.claude/skills/run-issue/SKILL.md` names a classifier refusal only for a lane's FILL or rebase resolution ("returns `BLOCKED` ... you then run the same bare command yourself"), not for the merge owner's own dispatch. From this PR on, `.claude/settings.json` is humanAlways, so a later ticket on it meets the owner at merge anyway. One ticket so far.

## 2026-11-02 — PR #472 (hostile corpus)

- Phase: implementation
- Observed: the mutation pass's hostile corpus (14 inputs, judged by `@cram/grounding`'s `claimSpans` and `quotesIn`, the server's code, not the view's) disagreed on two — a line two slides hold, and overlapping quotes — where the view dropped the later quote's mark and number; `6b7f4db` merges overlaps and the corpus agrees 14/14, with 51 of 51 mutants killed and two empty-run guards deleted rather than declared equivalent (PR #472's § Mutation). The defect was found before review, by `.claude/agents/ticket-agent.md` § 4's hostile-corpus rule on a web surface. No new signal; recorded for a graduation check of that rule.

## 2026-11-03 — PR #494 (swept run)

- Phase: implementation
- Observed: the #426 lane started a live `pnpm eval` in the background at `ccd75fb` and went on with the mutation pass in the same worktree. When the run finished, `writeRun` (`eval/src/run-files.ts`) wrote `eval/reports/ccd75fb.json` and swapped `6bd6b81.jsonl` for `ccd75fb.jsonl` under `eval/recordings/`. The lane's next `git add -A` staged all of it into `6cded4a`, whose subject is "cases for the guards the mutation pass found unprotected, and a truer maxLength docblock" and whose body says nothing about a run, a report or a deleted recording. By contrast `7f63fcd`, the one commit on the branch made for a run ("the tier-2 run at the merge commit 1525628"), added `1525628.json`. ADR 0005 § Decision (f) makes the PR ref the only place a measured commit can be reached, so a commit list that hides which commit added a report hides where that report came from. The lane named this in its Friction line. Nothing in the agent files or skills says how to stage files while a background run can still write to the tree; `verify-tier.sh` is the only place in `.claude/` that mentions `git add -A`. One ticket so far.

## 2026-11-04 — PR #565, PR #591, PR #610 (what a load red leaves unrun)

- Phase: process
- Observed: the one unowned shape left of this entry after the 2026-11-04 triage, which moved the rest to #588, #566, #483, #598 (a timeout red hides `check:ledgers`) and #612 (a ledger refusing a mention). #560's lane (PR #606, not yet merged at PR #611's retro): in its differential, `merge-pr.test.sh` case 3 failed once at load about 70 on a gh-stub time-box, which is a harness bound and not one of #588's four vitest tests (#600 and #601 own the other wall-clock bounds). It passed on every re-run. One lane so far on the harness time-box.

## 2026-11-04 — PR #573 (a mutant that never returns)

- Phase: implementation
- Observed: the #434 lane's Friction line: "a self-testing harness turns every widening mutant into unbounded recursion unless its self-runs refuse nesting. Without that refusal, the 'verdict = exit code' loop never gets a verdict." The lane lost about 90 minutes to widening-mutant runs that never ended, and killed and re-ran them after `bccc45d`, which added the recursion guard to `self_run`. `docs/standards/evidence.md` sanctioned form 6 says a mutant loop takes each verdict from an exit code, and nothing in it bounds how long one mutant may run. On this host neither `command -v timeout` nor `command -v gtimeout` finds anything (rc=1 each), so a bound has to be built by hand. #610's lane (#483) is the day's other loop that never ended: nine `pgrep -f` waiters on its mutant script, which is § Host conventions line 2's shape and is counted on #487 (https://github.com/TomBennett-Lloyd/cram.ai/issues/487#issuecomment-6636660466), not here. One lane so far on a mutant that never returns.

## 2026-11-04 — PR #602, PR #603 (a claim read at one moment)

- Phase: planning
- Observed: two lanes' Friction lines are claims that were true where they were read and not where they were stated. #602's lane (#471): "the premise that only the two harnesses name these paths was checked on b9ea323, not re-checked against a moving main (a130d1a added committed-run.test.ts:46)", and its restatement sweep "covered the rule but not the strings my own tests add", which became its own guard hit, fixed in `b439bea`. The premise's miss is #566 and criterion 2 of #471 now, and the lane reported PARTIAL and left #471 open. #602 also escalated BLOCKED at its rule 4 differential (6 head-regressions), and the owner's option B resolved it, which is the escalation working as designed. #603's lane (#492): "I pasted sweep rc values through | cut (evidence.md member 1) and claimed a re-run I had not pasted", and review caught both. Member 1 already names the pipe and form 7 the unpasted claim, so the text exists and review was the catch. That is the same as PR #563's lane (#216; its entry's push-order half is on #483), whose five FIX-NOW findings were all claim accuracy. One lane on a premise re-read against a moved `main`. One more on a catalogued claim form that review caught.

## 2026-11-04 — PR #605 (ten hosted attempts for a rare flake)

- Phase: process
- Observed: #588's acceptance asked for ten consecutive hosted runs, and the lane paid for them as ten serial re-runs of the `checks` job on `2424bf1` (run 41858266585). By the job timestamps they took about 64 minutes of runner time, each 5 to 7 minutes, and 102 minutes of wall clock, 15:29Z to 17:11Z. That bar did not earn its cost. The hosted evidence for the defect was #349 firing twice, on PR #498 and on PR #584's run 41849891917. `gh run list --created '2026-11-03..2026-11-04'` counts 207 runs (196 success, 10 failure), so the hosted rate is a few in some hundreds. At that rate, ten clean attempts are what an unfixed tree would most likely show too. The evidence that did show the fix was local: the wiring control turned exactly the six bounded sites red with the owner set to 1, and the four files passed 40 of 40 runs at load 95.90 to 70.58. The hosted runner is not loaded the way this Mac is, and the ordinary traffic (about a hundred runs a day) re-runs all four tests at no extra cost. One or two hosted attempts to show the bound holds on the runner, plus a check in the next week's merges that none of the four signatures comes back (issue item 4 asks the retro for that check, and no PR updated since the 17:44:09Z merge names any of the four issues in its body yet), would have given more evidence and saved about an hour. One issue so far on a hosted repeat count set for a flake this rare. The lane's two Friction lines are not their own entries. The dead `\b` arm is `docs/standards/evidence.md` rule 10, and the plan's positive control caught it as `docs/standards/architecture.md` rule 9 intends. On the `# Conflicts:` lines, a scratch fixture (Apple Git-157) shows the comment character is fixed when the stopped merge writes `MERGE_MSG`, not when the commit ends it. A merge started without `-c core.commentChar=';'` writes `# Conflicts:`, and a commit run with `;` and `strip` then keeps those lines as text. With the pair on both the merge and its `--continue`, the block is written as `; Conflicts:` and stripped. `.claude/agents/ticket-agent.md` § 8 already gives the pair for both commands, and review-loop step 5's `^[#;]` body check is what caught it, so the rule and the check both exist. The lane merged by hand, and `merge-pr.sh` was not involved. The merge-time `# Conflicts:` shape has one lane so far.
