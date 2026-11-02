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

## 2026-10-21 — PR #263

- Phase: implementation
- Observed: the #233 plan split the shared `IngestStatus` shape change (step 2) from the web consumer that answers it (step 3), and the lane had to land both in one commit because `pnpm verify` is whole-repo and the web package is red between them. A plan step that changes a shared type is not committable on its own; nothing in `.claude/agents/planner.md` asks whether a step's `Verify:` can pass before its consumers move. One ticket so far.

## 2026-10-21 — PR #291

- Phase: implementation
- Observed: the frontend-gate probe harness compares sets of `line:rule` pairs and merges duplicates, so it cannot see a rule reporting one fault twice; the #280 lane added a counting case for its own rule only. The lane also spent one fix round after removing comment handling on the measurement that postcss strips comments, which holds except for a comment with no whitespace on either side. One ticket so far on each.

## 2026-10-21 — PR #313

- Phase: planning
- Observed: the #283 plan set pdf.js's deletion of `<` and `>` aside as out of scope without checking it against the inverse the plan relied on, and the reviewer found that the deletion can break that inverse because pdf.js edits the string it reorders (filed as #305). The lane also rewrote three regex lines twice because a `\uXXXX` escape typed into a tool parameter arrives as the literal character. One ticket so far on each.

## 2026-10-21 — PR #313 (merge)

- Phase: process
- Observed: `merge-pr.sh`'s first run on PR #313 did `gh pr update-branch`, polled the new head green, and then refused at the merge step because the PR was `BEHIND` again: the #310 retro PR had merged during the poll. The merge owner's retro chains and lane-PR merges each serialise behind the merge they queue on, but not behind each other, so two independent chains can land one PR inside another's checks poll and cost it a full second CI round. First instance recorded; PR #235's entry (poll budget; deleted as stale by PR #303) was a different cause.

## 2026-10-21 — PR #324

- Phase: implementation
- Observed: the #300 lane's first cut used SQLite's read-only open flag and three repair tests failed, because a read-only connection leaves `-wal` and `-shm` beside the file on close and `rebuildCourse` reads a `-wal` as another connection still holding the file; `PRAGMA query_only` on a normal connection was the fix. One ticket so far on a library flag whose side effect is in the file system rather than in the API. Also the first `REBASE` bounce under `run-issue` step 5's pasted form (PR #310): seven shared files, resolved with no correction from the lane.

## 2026-10-21 — PR #336

- Phase: dispatch
- Observed: the #296 lane reported no friction of its own, but its merge made PR #337 (#294) DIRTY on the same `.claude/agents/ticket-agent.md` § 4 paragraph, costing that lane a source-conflict rebase round; a third lane (#293, PR #334) edits § 2 of the same file. The merge owner admitted all three in parallel with the overlap named in each dispatch, pricing it as rebase cost; a same-paragraph edit on an agent definition is same-file SOURCE overlap by `run-issue` step 1's own rule and should have been sequenced or batched at dispatch. One ticket so far on agent-definition edits colliding.

## 2026-10-21 — PR #329

- Phase: rebase
- Observed: in one of the #302 lane's three rebase rounds, a delete script whose assertion failed still reached `rebase --continue`, because the chain used `;` rather than `&&`; a tip commit made the missed deletion. Two of the three rounds were forced by redirect-row deletions on `docs/tech-debt.md` (#324, #327), both log-only. Counts toward a lane-side rule that a scripted rebase step chains with `&&` (`docs/standards/evidence.md` form 8 asserts the edit's count; this is the step after it).

## 2026-10-21 — PR #266

- Phase: implementation
- Observed: the #165 lane mutated the test-exclusion regex but not the line that applies it to the basename, and review found the surviving mutant. The guard's edges include the site that applies the pattern, not only the pattern's arms; second instance of a mutant list stopping at the regex (PR #278's anchoring mutants were the first, now in ticket-agent § 4's axes rule). One ticket so far on the application site.

## 2026-10-21 — PR #345

- Phase: merge
- Observed: the #297 lane found that `merge-pr.sh` has unioned a conflict confined to `APPEND_ONLY_LOGS` since #60 (PR #64), so the issue's proposed script change was already shipped; triage wrote the fix direction without reading the script's union step. On the merge owner's side, every log-only `REBASE —` bounce sent today (PRs #266, #269, #275, #324, #327 twice, #329 twice, #334) was avoidable under that union, each costing a lane round and a CI run; PR #345's step 5 now reads the conflicted set first. Second instance today of a triage issue restating shipped behaviour (#332's carrier sweep is the other).

## 2026-10-21 — PR #289

- Phase: implementation
- Observed: the #268 lane left two background wait loops of the form `until ! pgrep -f 268-mut/mutate.py; do sleep 15; done` running for 4 h 44 min after the PR merged: `pgrep -f` matched the loop's own command line, so the loop could never see the script finish. The lane read its result file directly and never noticed. The merge owner's `kill` was refused by the permission classifier and the owner killed them by hand. One ticket so far on a self-matching `pgrep -f` wait.

## 2026-10-21 — PR #351

- Phase: review
- Observed: the #276 lane argued away the plan's untracked-file arm during implementation by reasoning about module resolution, and the reviewer refuted the argument with a shadowing counterexample. An argument for deleting a planned guard needs a mutant shape drawn from the grammar list, not reasoning alone; one ticket so far, and ticket-agent § 4's hostile-corpus rule (PR #336) is the nearest home if it recurs.

## 2026-11-02 — PR #394 (plan counts)

- Phase: planning
- Observed: the #282/#287/#288 batch's plan carried its prototype harness counts (181/211/241 rows) as each chunk's expected baseline and one rule the prototype had settled under bash (`endsPattern` keeping `#`); zsh, the oracle, contradicted the rule, and each implementer added rows past the count (6, 8 and 27) to kill survivors, so every later dispatch had to be told the new baseline by hand. A row count in a plan is a figure the first chunk's edit invalidates; the plan could name the harness and let each chunk report its own. One batch so far.

## 2026-11-02 — PR #394 (plan hand-back)

- Phase: planning
- Observed: `.claude/agents/planner.md` returns the plan only as its final message (its tools are Read, Glob, Grep, Bash), and `.claude/skills/plan-issue/SKILL.md` step 5 posts a file, so the orchestrator re-typed about 20k characters of plan into a file to post it. One batch so far; filed as #412 (a `plan-<n>.md` scratch file, the shape `task-orchestrator.md` rule 8 (a) already names).

## 2026-11-02 — PR #394 (curated history)

- Phase: process
- Observed: every review fix on the batch folded into its member's commit by `--fixup` and autosquash (or `--amend` at HEAD), and a fold onto an earlier member conflicted whenever a later member had edited nearby lines; each was resolved by hand at the earlier position with the intermediate tree harness-checked (200 and 246 rows passing), later positions resolved to the known final tree under a tree-equality check, and two message rewords needed an `exec git commit --amend -F` line injected through the sequence editor. Fix rounds ran per member so the folds stayed per member, which serialised them (one #288 round ran about 2.6 h). First batch to merge `--rebase` under the one-commit-per-member rule; the cost is the rule's, recorded so the next batch can price it.

## 2026-11-02 — PR #394 (verify wall-clock)

- Phase: verify
- Observed: the batch's `pnpm verify` runs took about 15 minutes of wall-clock each under machine load (the round-2 record logged 2 to 10-plus minutes). Counts with PR #215 (9 to 15 minutes at load average 90 to 100) and PR #386 (10 to 13 minutes on the full tier) as the third lane to record the composite's cost under shared load.

## 2026-11-02 — PR #394 (#349 reds)

- Phase: verify
- Observed: two `pnpm verify` runs went red on `packages/ingest`'s `stored-text.test.ts` 5 s timeout under machine load, #349's signature (still open), and both re-runs were green with no change to the tree; the batch merged on CI green. Counts toward #349, which has now cost a lane two re-runs in one batch.

## 2026-11-02 — PR #397 (eval re-runs)

- Phase: implementation
- Observed: the #367 lane lost two `pnpm eval` runs (about 5 min each) to `eval/src/live-run.measure.test.ts`'s `one call answered two ways` refusal on "What is the third step of the guild's inspection checklist?": the run at `261729f`, then the first attempt at `bfa07b7`, both on the pinned Qwen3-4B over loopback Ollama at `{temperature: 0, seed: 0}`. The second attempt at `bfa07b7` recorded cleanly and is the committed run. The refusal keeps a recording that cannot replay out of the tree, and its only remedy is the `re-run` it names, so each occurrence costs a full run to find out; the PR body separately records that at temperature 0 this 4B model flips individual questions on a one-phrase prompt change. One lane so far.

## 2026-11-02 — PR #397 (measuredCommit regex)

- Phase: planning
- Observed: before any edit, the #367 lane measured the issue's two defects through a scratch harness that ran `runEval` (`eval/src/run-eval.ts`) against the live backends, and lost one 6-minute live run because the scratch report's `measuredCommit` failed `EvalReport`'s sha regex in `eval/src/report.ts`. The committed runner derives that value through `eval/src/measured-commit.ts`, which the scratch harness did not go through. The measurement was the right call: it showed neither defect has the cause the issue proposes, which is what stopped the lane (next entry). One lane so far on a scratch harness handing a committed schema a value the runner derives for it.

## 2026-11-02 — PR #397 (BLOCKED for the owner)

- Phase: planning
- Observed: the #367 lane stopped before any edit with `STATUS: BLOCKED — owner decision` (its first lane report, 2026-10-21 18:20Z), under ticket-agent rule 2 (an owner-only question) and rule 5(b) (the cause the issue proposes is not what the disk shows), after its measured run showed a unit stating the first sentence of a two-sentence bullet is supported by both verifier arms and that the prompt-only fix cost shown units (58 → 34) and answered questions (22 → 20). Of its three questions the owner answered Q1 (the withheld reason was `dangling-citation`) and redirected Q2 and Q3 to #366; the coordinator relayed that as a scoped PROCEED, the lane re-planned once, and PR #397 opened at 20:43Z, 2 h 24 min after the BLOCKED report. The lane's own Friction line names the cause: the issue's acceptance implied an ADR 0001 (d) / ADR 0003 (d) change but carried no `adr` label, so two of its three questions were the owner's. The stop is the shape PR #118's entry names as correct; recorded as an instance of it.

## 2026-11-02 — PR #397 (footprint)

- Phase: planning
- Observed: the #367 plan's `Files:` list named `packages/grounding/src/slide-text.ts` but not the test its new `slideLines` would need, and named `apps/server/src/server-fixture.ts` "and its callers" and `eval/src/*-fixture.ts` where the diff changed `apps/server/src/ask.test.ts` and `eval/src/run-eval.test.ts` and no fixture; with `docs/tech-debt.md` (the review's one SYSTEMIC finding) and `.claude/comment-density.baseline.tsv`, that is a five-file `Footprint change:` on a 23-file PR. The baseline rows were not owed: the PR adds no scanned source file (its one new `.ts` is a `.test.ts`), so the four lowered rows came from a `--ratchet` run the lane chose, and the lane's Friction line then records that run's cost — a code line shortened after a mid-lane ratchet reads as a rise. One lane so far on each; the ratchet-ordering half is commented on #404.

## 2026-11-02 — PR #407 (plan-time split)

- Phase: planning
- Observed: the #393 lane's first report (2026-10-21) stopped `BLOCKED — needs splitting` with nothing on the branch: acceptance 3 (misspelt golden variants and their recall@k) adds a field to `eval/questions.jsonl` and a metric row, both owned by `docs/adr/0005-evaluation-as-gate.md` § Decision (c) and (d), so one PR would have mixed a `humanAlways` edit with `packages/index`, `packages/shared`, `apps/server` and `apps/web` source. The merge owner's PROCEED accepted the split, a scope comment narrowed the issue to part A, and #395 (`adr`, depends on #393) took part B; the stopped lane's FTS5 probe and its misfire measurement over the 32 clean golden questions sat in the plan comment, and part A cited them rather than re-measuring. The lane's own Friction line names the cause: an issue that adds a golden-question field or a report metric could name the ADR at filing. With PR #397's (BLOCKED for the owner) entry, that is two lanes on 2026-10-21 whose acceptance implied an ADR change on an issue carrying no `adr` label.

## 2026-11-02 — PR #407 (eval re-runs)

- Phase: implementation
- Observed: the #393 lane lost one `pnpm eval` attempt at each of its two tier-2 runs, `8b759e7` and the merge `bc831ab`, to `eval/src/live-run.measure.test.ts`'s `one call answered two ways; re-run` refusal, and the second attempt completed each time (PR body § Eval, "Retries"; lane report, "one per run"). With the #367 lane's two (the `PR #397 (eval re-runs)` entry above) that is four lost attempts across two tickets, on the same pins and machine class, every run at `LIVE_SAMPLING` (`eval/src/live-config.ts`). `RecordingLog` (`eval/src/recording-gateway.ts`) keeps the conflicting pair only in the error message, so neither lane kept which call flipped, and the runner's only remedy is the re-run it names. Filed as #417 (`discovered`, not `workflow`): one pinned call answered two ways is a reproducibility defect in the gateway, the backend or the runner, and the friction here is only its price.

## 2026-11-02 — PR #407 (query_only lexicon)

- Phase: implementation
- Observed: the plan comment put the correction's candidate vocabulary and its stemmer tables in `temp` tables on the course reader, on the strength of a probe that opened a file `readonly: true` and created a `temp` `fts5vocab` table there; the server's reader (`openCourseReadOnly`, `packages/index/src/open-course.ts`) sets `PRAGMA query_only`, which refuses temp tables too, so `packages/index/src/course-lexicon.ts` holds them in an in-memory side connection rebuilt from `chunks` through `ftsValues`, with a test holding it equal to FTS5's own `fts5vocab` over `slides_fts`. The probe measured a read-only mode the reader does not run; a probe standing in for a module's connection could open it through that module. The lane declared the change in a `Footprint change:` line at the first edit. One ticket so far.

## 2026-11-02 — PR #407 (REBASE bounce)

- Phase: process
- Observed: PR #407 opened on 2026-10-21 with its tier-2 run at `8b759e7` measured against the pre-#397 baseline `2856743`; #397 merged at 12:06Z on 2026-11-02 (`e8d828c`), replacing `eval/recordings/`, and the merge owner bounced the lane REBASE. The lane merged `origin/main` instead (`bc831ab`, 12:09Z) so that `8b759e7`, the commit its committed report names, stays in the PR's lineage (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)), re-ran tier 2 at the merge (`fcc4ccb`, 12:29Z, one attempt lost, the entry above), took a scoped confirmation APPROVE on `bc831ab` + `fcc4ccb`, and the ritual's own update merge (`cafcd17`, 12:38Z) brought in two friction-log retros before the merge at 12:44Z: 38 minutes from the upstream merge to this one. No ratio metric moved against the new baseline `bfa07b7`; `eval/reports/8b759e7.json` stays committed as history. The bounce said REBASE and the ADR said merge; the lane followed the ADR and named it under Merge cautions. One ticket so far on a bounce verb a standing rule overrides.

## 2026-11-02 — PR #407 (PROCEED divergences)

- Phase: implementation
- Observed: the PROCEED's inflection rule could not run as written: `slides_fts`'s `unicode61` does no stemming, so "if the index's own tokenizer agrees" never joins `paint` and `paints`, the PROCEED's own example; and checking only "the nearest course term" rewrites `paint` to a same-distance, more common `pain`, the wrong correction the same sentence says to prefer leaving uncorrected over. The lane executed FTS5's `porter` stemmer over `unicode61` and the check over every term within reach, stated both under the PR's "What and why" with the `REVISE` that flips them, and continued without a stop, as the PROCEED's "without a further stop unless a question only the owner can answer" allows. The merge owner accepted both on 2026-11-02 as departures from its own design call in the PROCEED, not from the owner's words. A design call written into a PROCEED from a plan comment's probe is a value no probe had run against; one ticket so far on a lane finding that at the first test and saying so rather than asking.

## 2026-11-02 — PR #425 (overtaken revisions)

- Phase: planning
- Observed: the #366 lane dispatched the Fable planner seven times — the first plan, Revisions 1–5 and the Revision 5 amendment — every re-plan on owner direction (a REVISE and four addenda on 2026-10-21, Q3's answer on 2026-10-27, Q13's answer and its amendment on 2026-11-02), none on reality drift; its lane reports record Revisions 1 and 2 and the first draft of Revision 5's point 7 as overtaken by the owner's next message while their planner was still running, three of the seven. `.claude/skills/run-issue/SKILL.md` step 3 sends each answer "back to the warm agent verbatim" as it arrives, and nothing holds a relay for the rest of the owner's turn: on 2026-10-21 the first plan went up at 17:54Z, 18 minutes after the issue, and Revision 3 reported at 21:50Z. From the issue to the merge (2026-10-21 to 2026-11-02) the branch carried commits for 23 minutes (`ec1cfe9` at 13:05Z, merged 13:28Z). The cost is the owner's design conversation running one planner dispatch per message, which on an `adr` issue is the shape chosen rather than a defect. One ticket so far on overtaken dispatches; a relay that asks the owner whether the turn is complete before re-dispatching is the candidate if it recurs.

## 2026-11-02 — PR #425 (sweep PR arm)

- Phase: planning
- Observed: the #366 plan's restatement sweep (`docs/standards/architecture.md` rule 9's recorded form) carried a PR arm over every PR merged since the worktree's base and every open PR; at Revision 5's run (base `fe4a723`) the merged set was #394, #397 and #406 and the open set #407 and #414, and #407 re-pushed and merged during that planner run (lane report, 2026-11-02 12:46Z). By the PR every one of the five was merged, and the PR body re-ran all 25 families at HEAD `ec1cfe9` against `origin/main` at `19c1d95` as the baseline, showing every family's hit set changed only in the twelve files the PR edits. The arm is a snapshot of `main` taken at the start of a planner run, so on an issue whose plan then waits days for the owner it is stale by the time the lane reads it; the HEAD-versus-base re-run is what held. One ticket so far.

## 2026-11-02 — PR #425 (comment cap)

- Phase: planning
- Observed: the #366 plan outgrew one GitHub comment at Revision 3 (lane report: 50,101 characters against the 65,536 cap) once the rule 9 sweep's full hit lists were in it, so the lane repurposed its earlier report comment as a companion directly below the plan and moved the sweep output there, declaring the split a divergence in plan § 4. By Revision 5 the plan read 58,535 characters and the companion 62,257, the companion also holding the § 4 divergences and the § 9 follow-up bodies "for space"; `gh` reads 59,186 and 62,257 after the PROCEED quote was added at the plan's head. `.claude/skills/plan-issue/SKILL.md` step 5 posts one file with `gh issue comment --body-file` and names no cap, and #412's scratch file changes how the plan reaches the comment, not its size. First plan to hit the cap; what filled it was the sweep's recorded form — families A–Y, every hit listed and classified — on a plan that changes the repo's central claim.

## 2026-11-02 — PR #432 (oracle configuration)

- Phase: review
- Observed: the #369 lane's hostile corpus for `namedTags` (`packages/index/src/topics.ts`) was judged by FTS5 phrase matching under `unicode61 remove_diacritics 0`, a tokenizer the lane configured, while the index's `slides_fts` runs plain `unicode61`; the PR body claimed agreement with FTS5 over the 29 pairs, and the first reviewer pass (one of its 10 FIX-NOW findings) measured the claim false under the index's own setting on `cafe culture`/`café`, `Istanbul`/`İstanbul` and the NFC/NFD forms of `naïve bayes`, with a spacing-mark split that disagrees under the lane's setting too. The fix narrowed the claim to the corpus and its setting and recorded the disagreements under `docs/tech-debt.md`'s `TERM` entry, so the words list folds `café` to `cafe` and the topic list does not. Second lane on this tokenizer after PR #407's (PROCEED divergences) entry, which assumed a stemming it does not do; with PR #407's (query_only lexicon) entry that is a third probe run under a setting the module it stands in for does not run. Candidate rule if it recurs: an oracle standing in for a component the repo configures is opened with that component's own declaration, read from the file that owns it.

## 2026-11-02 — PR #432 (step commits)

- Phase: implementation
- Observed: the #369 lane landed plan steps 1–5 as one commit, `f9f4c89`, and said why in the plan comment's Footprint line: `pnpm verify` takes about 10 minutes on this machine and the steps build on each other. `.claude/agents/ticket-agent.md` rule 4 asks for a commit per step "whose gate is green", for recovery after a dropped connection rather than for merge granularity (the PR squash-merged as `f1df348`), and names no gate cheaper than the composite; the lane read the gate as the full verify and paid it once. Fourth lane to record the composite's wall-clock (PR #215, PR #386 and PR #394's (verify wall-clock) entry) and the first where the cost changed the commit shape; #319 (open) is the classifier side.

## 2026-11-02 — PR #432 (re-cut widening)

- Phase: planning
- Observed: `carriedTags` (`packages/index/src/topics.ts`) puts every tag of a slide onto every new chunk when `replaceEmbedder` re-cuts it differently, compared chunk by chunk, so a tag on one fact widens to the whole slide and none is lost; the plan comment declared it, the PROCEED accepted it, the review left it standing, and the PR body states it as the behaviour rather than as a defect. No `docs/tech-debt.md` entry or issue names it: #430 (the owner's Q1 answer) re-applies a student's edits by chunk text hash across a rebuild, the mechanism a re-cut would need, and nothing asks for it on `replaceEmbedder`. One ticket so far on a coarse behaviour a plan declares and nothing then owns.

## 2026-11-02 — PR #432 (unkillable weight)

- Phase: implementation
- Observed: `TOPIC_LIST_WEIGHT` (`packages/index/src/course-index.ts`) is 1, the unit weight the other two lists carry as a literal, so mutant W1 (the constant → 1) has no input that tells the owned value from the literal, and the lane reported it under the `Mutation:` line's `unkillable` slot with the reason, as `.claude/agents/ticket-agent.md` § 4 asks; the weighting itself died at R4, and the three guards whose mutants also survived were removed as equivalent, each with a second shape named. The value is provisional until #426's measured run (#69), as `RETRIEVAL_K` is, but that one sits off the unit so a mutant can move it; a provisional owned value at its neutral default is held only by its docblock until it is tuned. One ticket so far.

## 2026-11-02 — PR #418 (hand-back)

- Phase: process
- Observed: the #408 lane's last commit was `1617f4b` at 12:42:46Z (`gh pr view 418 --json commits`), and PR #418 opened at 12:52:54Z with its `## Lane report` section reading "(pending — written once CI settles)"; the PR was DIRTY on `docs/tech-debt.md` alone, which GitHub runs no checks on, so the wait had no end and no report reached the top level on its own. The report the body now holds is its 15:00:39Z edit, 2 h 17 min 53 s after the push, written after the merge owner messaged the lane (its CI line reads "Per the coordinator, merge-pr.sh's union clears this at merge, so I did not rebase again"). `.claude/agents/ticket-agent.md` § 7 orders mergeability before the checks watch and § 8 bans anything reaching the top level before the report, so a lane watching checks that cannot start reads the same as a lane at work until someone asks. One lane so far.

## 2026-11-02 — PR #418 (CI silence)

- Phase: merge
- Observed: PR #418 opened DIRTY on `docs/tech-debt.md` alone after the lane had rebased once onto `0654737` and unioned the log: #407 merged at 12:44:47Z (`19c1d95`), 2 min after the lane's push, touching the log again, and #432 (`f1df348`, 14:58:41Z) touched it once more. `gh pr checks 418` read "no checks reported" throughout, since a conflicted PR has no merge ref. The merge owner took `.claude/skills/run-issue/SKILL.md` step 5's logs-alone arm: `merge-pr.sh`'s union commit `1a2b03f` landed at 15:01:28Z, the five checks completed between 15:02:00Z and 15:08:06Z, and the merge followed at 15:08:13Z, so the PR's first and only CI run was the merge's own. The `PR #345` entry priced each log-only `REBASE —` bounce at a lane round and a CI run and named the union as the saving; this is the union's side of the price — a DIRTY-on-logs PR shows no CI verdict until the merge owner commits to merging it, and the lane's own re-clear bought a 2 min head start. The log's `PR #394` and `PR #407` entries record no CI-silent wait (PR #407's lane report reads `CI: green`); first instance recorded.

## 2026-11-02 — PR #418 (M8 re-run)

- Phase: implementation
- Observed: the #408 lane's mutant M8 (record the sha at classify, not at the ready verdict) was three edits, and its first run under a `408-mut-M8-*` name applied a copy of M7's edit instead; the lane caught it, re-ran it as `M8b`, and the PR body's table and the lane report's `wasted work` both say so. The cost was one run of the nine-case scratch harness the lane built because the committed one takes ~2 min a run (#434). `docs/standards/testing.md` rule 8's loop is apply, run the one test file, revert by the inverse edit; nothing in it checks that the edit applied is the mutant named, and a hand-applied multi-edit mutant is where that shows. One lane so far.

## 2026-11-02 — PR #437 (A1 precision)

- Phase: planning
- Observed: the #420 plan's A1 check ran the pinned cross-encoder over one hazard sentence per covered set item against each expected slide's whole text and reported 11/11 at contradiction ≥ 0.5, so whole-slide premises stood for both depths; it ran no unrelated pair. The step-6 live run (`f9019d4`, every golden question, `dev-apple-silicon`, the pins) then showed the same checker scoring contradiction at 0.9–1.0 between a sentence and a retrieved slide on another subject: the deep contradiction set passed 11/22, 25 of 42 chat sentences carried a mark, none of them a forbidden sentence, and the lane stopped `BLOCKED` under `.claude/agents/ticket-agent.md` rule 5(b) at 14:26Z with steps 1–5 pushed (`f9019d4`, 14:17Z). The owner's answer — one entailing slide outweighs any contradiction — landed as `f20f038` at 15:04Z and amended ADR 0009 (d)/(g) in the same PR; steps 1–5 stood, and the lane's report reads wasted work as none. `.claude/agents/planner.md`'s `Assumption:` rule asks for the exact command that checks a value, and A1 had one; what it measured was the positive class alone. The `PR #407 (query_only lexicon)`, `PR #407 (PROCEED divergences)` and `PR #432 (oracle configuration)` entries are probes run under a setting the module does not run; this is a probe run under the right setting on half the input, the fourth pre-plan probe whose result did not hold at the first live run. Candidate rule if it recurs: a check that stands in for a classifier's verdict runs both classes — the pairs it must flag and a sample of the pairs it must not.

## 2026-11-02 — PR #437 (prompt variants)

- Phase: implementation
- Observed: with the amended rule the deep contradiction set's two reds were "Are worker bees male or female?" (the slide's own line, entailed at 0.002 against 01/3's whole text and 0.995 against the line alone; now #439) and "How long does capped honey keep?", where the generator returns `null` at both depths. The lane tried two one-sentence prompt variants over the set — "If no source says anything that answers the question, the answer is null." scored 17/22 and "If a source says what the question asks, explain what it says. If none does …" 19/22 — each moving other items to `null`, and kept the prompt as written at 20/22; the lane report's wasted work is those two runs, and #216 keeps the `null`. PR #397's body recorded that this 4B generator at `{temperature: 0, seed: 0}` flips individual questions on a one-phrase prompt change (the `PR #397 (eval re-runs)` entry); this is the second lane to measure it and the first to spend set runs on it.

## 2026-11-02 — PR #437 (#349 re-run)

- Phase: verify
- Observed: the lane's `pnpm verify` before the verdict commit (`fill-verdict.sh`'s run, lane report) went red once on `packages/ingest`'s `stored-text.test.ts` timeout, #349's signature (open since 2026-10-21), and the one sanctioned re-run passed with no change to the tree. With the `PR #394 (#349 reds)` entry's two, that is three re-runs bought by #349 across two lanes on 2026-11-02.

## 2026-11-02 — PR #437 (red by design)

- Phase: verify
- Observed: the lane's BLOCKED report carries `Verify: rc=1` with one red leg, `eval/src/committed-run.test.ts`, because the committed `bc831ab` report and recordings predate the new prompt and report shape and `eval/README.md` says it fails until the tier-2 run re-records them; the lane then ran the legs after `pnpm test` one by one to show them green, and `f9019d4`'s commit body says the same. A ticket that moves the report shape has no green composite between its first eval edit and its tier-2 run, so its step commits (the `PR #432 (step commits)` entry: `.claude/agents/ticket-agent.md` rule 4's commit per step "whose gate is green") are made against a red one, and `CLAUDE.md` § Commands' "never hand-pick a subset" has no arm for a leg that is red by design. One ticket so far.

## 2026-11-02 — PR #437 (PARTIAL Closes)

- Phase: merge
- Observed: the lane reported `STATUS: PARTIAL` on one acceptance row (the deep contradiction set at 20/22) and wrote `Part of #420` with no `Closes` line, as `.claude/agents/ticket-agent.md` rule 7 says partial progress is written; the classify step of `.claude/scripts/merge-pr.sh` refuses a lane report whose issue no `Closes` line names ("the lane report names #420 but no Closes line does"), on the same rule 7's sentence that the lane closes its own issue. The merge owner re-ran it with `--method squash` — the override the script's own comment reserves for "an operator who knows the lane" — and closed #420 by hand after the merge (`f69d224` at 16:40Z, the close at 16:41Z), the residual pointed at #216 and #439. The two texts disagree on what a PARTIAL lane writes when its residual is owned elsewhere: rule 7's `Part of` keeps the issue open, and the classify arm refuses an open issue. First lane PR to reach this arm (`docs/friction-log.md`, `docs/review-feedback.md` and `docs/tech-debt.md` on `main` carry no earlier `--method`); the refusal landed before `update-branch`, as the script's design puts it, so it cost one re-run and nothing else. Whether such a lane writes `Closes` with the residual's owners named, or the override and the hand-close stay the path, is one lane's evidence.

## 2026-11-02 — PR #437 (dropped discovered)

- Phase: process
- Observed: the lane's BLOCKED report (14:26Z) read `Discovered: none filed.` and named one candidate — `splitClaims` does not split after a closing quote mark, "worth an issue once the gate decision is known" — and its final report's line reads `Discovered: #438.` and nothing else; no issue named the defect until this retro filed #444. The `Discovered:` line is contractual for each report and not cumulative, and the final report was written after a re-plan on the owner's decision, so a candidate a report held back on its own condition had nothing carrying it to the next report. One lane so far.

## 2026-11-02 — PR #455 (plan file)

- Phase: planning
- Observed: the #410/#411/#412/#427 batch's planner (Fable, budget mode `normal`; 179k tokens, 30 tool uses and about 14.5 min by the orchestrator's round notes) wrote its plan to `plan-410.md` by Bash heredoc and named the path on its first line — #412's rule, applied before #412 merged, which it did in this same PR as `0774cb9` — and the orchestrator posted that file with `gh issue comment --body-file`: 39,780 characters by `gh api`, re-typed nowhere. The `PR #394 (plan hand-back)` entry is the cost it removed (about 20k characters re-typed into a file). First use of the rule, one batch so far; recorded so a later graduation check can date it.

## 2026-11-02 — PR #455 (humanAlways drop)

- Phase: planning
- Observed: #411 left the batch at the plan checkpoint because the planner's `docs/standards/architecture.md` rule 9 sweep for its route found `CLAUDE.md:55` ("Systemic findings go to `docs/tech-debt.md`, not into endless iteration") as an unqualified restatement, and `CLAUDE.md` is `humanAlways`, which a batch never carries (`.claude/workflow.json` → `orchestration.routeRule`; `.claude/agents/task-orchestrator.md` rule 7's drop at the checkpoint). The issue body named the skill's `description` line as a carrier and not `CLAUDE.md`, so admission's composition test (`.claude/skills/run-issue/SKILL.md` batch lane step 2, "no expected humanAlways paths"), which predicts from the issue body, predicted none; the orchestrator had applied `planned` to #411 before the strike and removed it. The cost was small — C2's text stands as #411's starting plan and #411 runs as its own ticket-agent lane (open) — and the first grep of `CLAUDE.md` for the route's wording was the planner's. Counts with #433's three plan-time stops (#367, #393, #369) as a fourth plan that found a file its issue did not name, of a different kind: those were ADR Decision points, and #449's dispatch-time read (PR #449, open and unmerged at this retro) reads each acceptance bullet against the ADRs `docs/adr/README.md` § Index lists, owning a bullet "when satisfying it would edit a file under `docs/adr/**`" — `CLAUDE.md:55` is outside that read, so it would not have caught this one.

## 2026-11-02 — PR #455 (verify under load)

- Phase: verify
- Observed: the batch's diff is five `.md` files (`08c1403`, `0774cb9`, `903c78c`) and its wall-clock went mostly to `pnpm verify`: by the orchestrator's notes, C3's implementer lost three runs to eval timeouts at load average 46–51, cycle 1 lost one to `packages/ingest`'s stored-text timeout (green alone), C4's run took over 10 minutes, and one run was stopped part-way (TaskStop) because a cycle-2 fix changed the tree under it — four whole re-runs in the #441/#349 class at load averages of 46 to 62. Every run was `verify:full`: the plan predicted that from `.claude/settings.json` (held, never committed), and the classifier derives it for the merged set anyway — `bash .claude/scripts/verify-tier.sh --dry-run` on the batch head `2491e46` prints `full — 5 file(s); a test file references a markdown path in this change set`, the hit being `.claude/scripts/merge-pr.test.sh:3076`, a comment naming `.claude/skills/run-issue/SKILL.md`, the docs rung's documented false-positive direction; no test file names the other four. Fifth lane to record the composite's wall-clock under shared load (PR #215, PR #386, the `PR #394 (verify wall-clock)` and `PR #432 (step commits)` entries), and with the `PR #394 (#349 reds)` entry's two and the `PR #437 (#349 re-run)` entry's one, seven re-runs bought by the timeout class across three lanes. #319 (open) is the classifier's issue and covers code edits; nothing names a test comment that buys an `.md`-only set the full tier.

## 2026-11-02 — PR #455 (plan-text findings)

- Phase: review
- Observed: the reviewer's cycle 1 returned 10 FIX-NOW, and the handover places every one in the rule text the plan specified and the implementers (Opus, all `DONE` first time) applied as written: a guard-only count under a "parser or guard" scope, "never re-typed" beside its own fallback, a `head -1` check that cannot see the contest it claims to, rule 1 pulling rule 8's BLOCKED consequence into itself, copies of the owned `plan-<n>.md` literal, three bare-form restatements, a quoted field that does not exist, a duplicated sentence, and #447 (next entry). Cycle 2 found one FIX-NOW the cycle-1 fix introduced and cycle 3 approved — 3/3 of `.claude/skills/review-loop/SKILL.md`'s cap, no confirmation pass. On a batch whose chunks are rule text the plan's text is the diff's text, so the review loop was the plan's review; `.claude/skills/plan-issue/SKILL.md` step 4 reads a plan for executability (real files, checkable acceptance, a DAG, sweeps with controls, mutants that bite, literal code that cleared the gate) and nothing there reads a rule's text against the rule beside it, which is what cycle 1 did. Counts with the `PR #248` entry (a plan comment committing to a shape before review had seen it) as the second where review's object was the plan, and the first batch where the plan was the whole diff.

## 2026-11-02 — PR #455 (duplicate discovered)

- Phase: process
- Observed: the batch filed #447 at 17:18:52Z from its plan's out-of-scope line (`.claude/skills/review-loop/SKILL.md`'s inline bound ledger naming `docs/design/task-orchestrator.md`, a file this repo does not have) and closed it at 17:38:46Z as a duplicate: `docs/tech-debt.md` already held "2026-11-02 — merge-pr.sh and review-loop cite docs/design/task-orchestrator.md, which this repo does not have" from the #408 review's cycle 1, and wider (it covers `.claude/scripts/merge-pr.sh`'s two comments too). The cycle-1 reviewer found the entry; the orchestrator's notes record that it had not searched the log. `.claude/agents/ticket-agent.md` § 5 (e) and `.claude/agents/planner.md`'s discovered-scope line say `gh issue create --label discovered` and name no search first; `.claude/skills/execute/SKILL.md`'s `DISCOVERED:` line, "(or comment on an existing issue)", is the one text naming the alternative, and none names `docs/tech-debt.md`, which `/triage` later converts into the same kind of issue. #411 (open, its own lane now) sends a batch's SYSTEMIC findings to issues rather than the log, so a batch and a single lane recording one defect in two places is the shape that rule makes routine. One instance so far.

## 2026-11-02 — PR #443 (amendment title)

- Phase: planning
- Observed: issue #395's title reads "ADR 0005 amendment", the wording `docs/adr/0005-evaluation-as-gate.md` § Decision (c) itself uses ("a metric that needs it adds it by amendment"); `docs/adr/README.md` § Amendments (#114) allows an in-place edit of a merged ADR only for a stated value that moved, so the planner's owner question 1 recommended a new ADR 0010 extending 0005 (c) and (d), citing 0006 (h) and 0009 (o) as the two metric rows already added that way, and the PROCEED ("proceed 395") took it. The cost was one owner question carrying its recommended answer, with nothing on the branch; the lane's first report proposes that an issue adding a golden-question field or a metric row name the form at filing. #433's dispatch-time read (`ec0093b`, PR #449, merged 18:46Z) calls a bullet an ADR's when it extends a Decision point or adds a member to a set a point enumerates, and puts the `adr` label on — #395 carried it already — and decides nothing about the form. #430 ("ADR 0004 amendment: topic tags survive a rebuild") carries the same title shape on a change #433's text describes as reversing 0004 (d), so a second instance is queued. One ticket so far on a title naming a form the README does not allow.

## 2026-11-02 — PR #443 (REBASE eval run)

- Phase: implementation
- Observed: the lane's review-fix commit `b6b51b6` landed at 16:40:11Z and #437 merged 21 seconds later (`f69d224`, 16:40:32Z), replacing `eval/recordings/`; the live `pnpm eval` running on the pre-merge tree was stopped at the REBASE bounce, the lane merged `origin/main` rather than rebasing (`f60add1`, 16:45:52Z; the one conflict, in `eval/src/run-eval.ts`, put variant retrieval inside #437's single-retriever loop) under `docs/adr/0005-evaluation-as-gate.md` § Decision (f), re-ran, and committed the report at `6c4f362` (16:54:47Z): 14 minutes from the upstream merge to the new report, against the `PR #407 (REBASE bounce)` entry's 38. The plan's Risks priced it ("whichever lane merges second re-records"), and the lane report files the stopped run as its only wasted work. Second lane after PR #407's on a bounce verb the ADR overrides, and second to lose a live run to the other eval lane merging first.

## 2026-11-02 — PR #443 (#441 reds)

- Phase: verify
- Observed: `eval/src/ingested-course.test.ts`'s 5 s timeout under load, filed by this lane as #441 (17:51Z) after two consecutive red `pnpm verify` runs at `6752432` (16:20 and 16:23 local, 5017 ms and 5033 ms, load average 34.38, the file alone passing in 1.42 s), went red again on the first run at `c06b01c` (the lane report's Verify line; the one re-run that signature allows was green) and, per the merge owner's retro brief, once more on the FILL's run before `6534123`, where the lane waited for the load average to fall from 93 before spending its one re-run. #441's own text says it is #349's class in a second file and that #349's "re-runs once" rule names only its own file, so the lane applied the rule by analogy. The `PR #455 (verify under load)` entry counts seven re-runs bought by the timeout class across three lanes on 2026-11-02; this is the fourth lane, paying four red runs to one signature, and the first to time its re-run against the load rather than run it at once; nothing states whether the one re-run may wait.

## 2026-11-02 — PR #443 (report channel)

- Phase: process
- Observed: PR #443's `## Lane report` was last edited at 17:20:29Z (`userContentEdits`), the report at head `c06b01c` reading "still owed: CI green at c06b01c, then the awaiting-review label" and "branch BEHIND main by docs-only 7345e00"; the lane then committed `63e003f` (17:33:40Z, its merge of `7345e00`) and the FILL's verdict `6534123` (18:25:50Z), and the body was refreshed for neither, though `.claude/agents/ticket-agent.md` § 8 says a bounce round, `FILL` included, ends in a refreshed report posted where it outlives the lane. The merge owner's retro brief records the lane instead re-sending its report to the top level while parked under `awaiting-review` (labelled 17:25:47Z, merged 18:38:31Z) with nothing new in it, until the merge owner acknowledged it, and reads the loop as the lane resuming on each notification. The durable copy at merge therefore names a head two lane commits behind the one that merged, and the chat copies carried what the body did not. One lane so far on the two copies diverging in that direction; the `PR #418 (hand-back)` entry is the body going stale the other way, with no chat copy at all.

## 2026-11-02 — PR #443 (merge -F -)

- Phase: merge
- Observed: with the FILL committed (`6534123`, 18:25:50Z) and `main` at `903c78c` (PR #455's three members, 18:21:53Z) the branch was BEHIND again; the merge owner's retro brief records the lane attempting `git merge -F -`, the commit message on stdin, which the lane's environment did not support, and leaving the BEHIND state rather than retrying, so the merge owner's `gh pr update-branch` made `b91e4f8` (committer GitHub, 18:33:54Z) and the squash followed at 18:38:31Z. The lane's two earlier merges of `origin/main` (`f60add1`, `63e003f`) carried their messages inline, so the form was the lane's choice, not a gap. Recorded because the stop was the right one and cost 8 minutes, and because the `PR #418 (CI silence)` entry priced the same update-branch as the merge owner's cheapest clear.

## 2026-11-02 — PR #449 (queue re-order)

- Phase: merge
- Observed: the #433/#413 batch's PR opened at 17:26Z and was green on `633cc45` and BEHIND at its first report; it took three curate rounds with no content change in any: `633cc45` → `4542b3f` onto `7345e00` (the initial BEHIND), then `4542b3f` → `0629ceb` onto `903c78c` after the merge owner moved #455 (merged 18:21:53Z) ahead of it, then `0629ceb` → `eb0c95d` onto `2cfea7e` after #443 (owner-approved, merged 18:38:31Z) was moved ahead too; the batch merged at 18:46:11Z. Each round cost the lane a rebase, a whole local `pnpm verify` (about 12 min at load 36–46) and a CI run (about 6 min), while other merges were held. Neither re-order was a key (1) case — no lane depended on #455 or #443 — and at each one the batch's checks were mid-run or about to start, which is the one wait key (2) of the `**Merge order**` paragraph this very PR adds to `.claude/skills/run-issue/SKILL.md` prices ("waits for that one CI run"). Rounds 2 and 3 were the merge owner's decision to re-order mid-curate, the race #413 recorded on PR #394, repeated on the PR that writes its rule; the cost is the merge owner's, not the batch's. First observation of that wait being bypassed, taken while the clause was still on the branch.

## 2026-11-02 — PR #449 (overlap-read control)

- Phase: planning
- Observed: the #413 plan prescribed the overlap read as a four-command sequence for the merge owner to run — `T=$(git merge-tree --write-tree origin/main origin/<R>)`, `git commit-tree "$T"`, then two `merge-tree` reads — and its positive control was `R=origin/408-merge-pin-head` against `H=origin/297-merge-union-logs`, two already-merged branches, recorded as "RC=1 on both calls"; it was never run on a conflicted pair. On one, the first command exits 1 and `$T` captures the conflict listing with the tree, so `commit-tree` breaks on a log-only conflict, and the C2 implementer rewrote around it rather than stopping; the merged text reads `out=$(…); rc=$?; T=${out%%$'\n'*}`. Cycle 1 returned 6 FIX-NOWs, every one in that paragraph (the capture, `origin/<H>` unreadable for a lane that has pushed nothing, a head-pin misattribution, a near-hold sentence). `.claude/skills/plan-issue/SKILL.md` step 4 asks that every prescribed mutant is shown to bite and that literal code has cleared the real gate; it asks nothing of a command sequence a plan prescribes for someone else to run. Filed as #461 beside #458, which is the same step's other unchecked claim.

## 2026-11-02 — PR #449 (fixes at cap)

- Phase: review
- Observed: the batch's review ran 3 cycles with FIX-NOW counts 6, 2 and 1, then a confirmation APPROVE, and cycles 2 and 3 each found that the previous cycle's fix text asserted behaviour no agent file provides — a mid-run `REBASE —` bounce, then a pre-report rebase (cycle 3 found one of cycle 2's own fixes doing the same). The orchestrator's prose fixes, written at cap pressure, minted false claims faster than they closed them; the move that converged was deleting the claim and citing #448, the `discovered` issue that owns the missing entry. The `cumulo#398` lesson in `.claude/skills/review-loop/SKILL.md`'s exit conditions names this shape for derived figures ("delete the derived figures rather than track them"); here the derived thing was a promised mechanism. One batch so far on a merge-owner rule whose fixes promise what no lane implements.

## 2026-11-02 — PR #449 (local verify red)

- Phase: verify
- Observed: on the batch's last three curated trees the local whole `pnpm verify` went red only on load timeouts owned by open issues while CI's `verify:full` passed on every pushed head. At `633cc45`: red twice (`eval/src/ingested-course.test.ts` → #441; `packages/ingest/src/stored-text.test.ts` → #349; load average about 46), RC=0 on the third whole run. On the `903c78c` tree: red twice (`eval/src/render-deck.test.ts` hook timeout at 10000 ms, a new file in the class; `ingested-course.test.ts` again; load about 36–42), both files passing in isolation in 6.5 s. At `eb0c95d`: RC=1 on a single `stored-text.test.ts` timeout. The orchestrator pushed ahead of a green local RC twice to keep the merge hold short — once before reading the first red run's RC at all, once force-pushing `0629ceb` — and let CI be the verdict; harmless on an unchanged tree, but the order is read the RC, then push. Counts with the `PR #455 (verify under load)` and `PR #443 (#441 reds)` entries, five more red runs to the class on the same day; `render-deck.test.ts` is the third file in it after #349's and #441's.

## 2026-11-02 — PR #449 (BSD grep bound)

- Phase: implementation
- Observed: the plan's C2 acceptance grep `curate onto latest main[^.]{0,300}Merge order` cannot run under macOS BSD grep, whose repetition bound caps at 255, and the `tr '\n' ' '`-joined form the implementer reached for misses phrases wrapped across lines, because the wrapped lines' indent joins into the phrase. Each cost a re-wrap of the pattern or a perl fallback. One batch so far on a plan acceptance pattern written for GNU grep's bounds on a tree whose owner runs BSD grep.

## 2026-11-02 — PR #449 (perl encoding)

- Phase: implementation
- Observed: the orchestrator's one inline perl edit to `.claude/skills/run-issue/SKILL.md`, run without `-CSD`, double-encoded the whole file once; `git diff --stat` showed 99/69 lines against the expected 33/3, and the edit was reversed line by line. Its later inline edits went through python with explicit utf-8. One batch so far.

## 2026-11-02 — PR #445 (backtick arm)

- Phase: planning
- Observed: #411's lane started from chunk C2 of the #410 batch plan, which the batch struck at its plan checkpoint (the `PR #455 (humanAlways drop)` entry). C2's sweep swept the route with `→ docs/tech-debt|to docs/tech-debt|append to .docs/tech-debt` (https://github.com/TomBennett-Lloyd/cram.ai/issues/410#issuecomment-6581996825). The third arm stands in for the backtick with `.`. The second does not, so it misses `.claude/skills/review-loop/SKILL.md`'s Exit conditions bullet "demoted to `docs/tech-debt.md`". The lane's own sweep added the claim arm `demot|overflow|destined for|logged to` before the first edit (https://github.com/TomBennett-Lloyd/cram.ai/issues/411#issuecomment-6582091940). That arm returned the bullet, and the lane edited it as a declared divergence from C2 (PR #445, Lane report → Retro). The cost was nil because the lane re-swept rather than inheriting C2's output. Counted on #377 (one control per arm) at https://github.com/TomBennett-Lloyd/cram.ai/issues/377#issuecomment-6586762525.

## 2026-11-02 — PR #445 (md-only full tier)

- Phase: verify
- Observed: PR #445's diff is five `.md` files. `bash .claude/scripts/verify-tier.sh --dry-run` on its head `4f8e6e4` still prints `full — 5 file(s); a test file references a markdown path in this change set`, with 53 guard hits: 52 in `.claude/scripts/merge-pr.test.sh` and 1 in `.claude/scripts/fill-verdict.test.sh`, all fixture strings naming `docs/review-feedback.md` or `CLAUDE.md`. So the lane paid the vitest legs of the full tier. By the lane report it lost "three local verify runs" to machine load, on #441's signature (`eval/src/ingested-course.test.ts`) at `584ddd4`. The FILL's first run at `4f8e6e4` went red on #349's (`packages/ingest/src/stored-text.test.ts`), and the one sanctioned re-run passed (the merge owner's retro brief; Lane report → Verify). Every `awaiting-review` PR carries a `docs/review-feedback.md` line (`CLAUDE.md` § Workflow), and retro PRs #463 and #468 record the same full tier on a one-file friction-log append. So the docs rung is unreachable for both classes by construction. Filed as #471. This lane joins the others on 2026-11-02 that paid the #349/#441 timeout class: the entries `PR #394 (#349 reds)`, `PR #437 (#349 re-run)`, `PR #455 (verify under load)`, `PR #443 (#441 reds)` and `PR #449 (local verify red)`. It is the first of them whose change set had no source in it.

## 2026-11-02 — PR #445 (push before verify)

- Phase: process
- Observed: in its own report the lane says it "pushed the rebased head in the same command as its verify and so before reading the result". That verify was red on #441's load signature, and CI then passed on that head, `584ddd4`. GitHub's timeline records the force-push of `584ddd4` at 17:16:48Z. `.claude/agents/ticket-agent.md` § 8 orders a rebase round as "then re-verify and force-push your own branch only". The lane's single command ran both steps in that order without gating the push on the verify's rc. The cost was nil because the red was load, not the tree. This is the second instance on 2026-11-02. The `PR #449 (local verify red)` entry records the batch orchestrator pushing ahead of a green local RC twice, "once before reading the first red run's RC at all". Both were harmless on an unchanged tree, and both pushed under load reds of the #349/#441 class, the class that makes a lane want CI as the verdict.

## 2026-11-02 — PR #445 (FILL quote)

- Phase: merge
- Observed: the owner approved in chat as "approve 454 and 445". The merge owner's retro brief records its FILL bounce giving the verdict text as "145" [sic], and the lane correcting it to the owner's real words. `4f8e6e4`'s Verdict line reads `approved 2026-11-02 — "approve 454 and 445"; the CLAUDE.md:55 pointer stands`. `.claude/scripts/fill-verdict.sh` writes whatever `--verdict` it is passed ("the verdict is the caller's"), and `.claude/agents/ticket-agent.md` § 8 says "A `FILL` runs exactly as sent". So the lane's catch was the only check on the relayed quote, and it departed from that sentence to make it. Counted on #295, the merge owner's bounce notes carrying unchecked claims, at https://github.com/TomBennett-Lloyd/cram.ai/issues/295#issuecomment-6586762869.

## 2026-11-02 — PR #445 (union at merge)

- Phase: merge
- Observed: the branch went DIRTY on `docs/review-feedback.md` alone. `main` gained #395's entry in `2cfea7e` (18:38:30Z) after the branch base `f69d224`. The lane's report ran a trial union locally and did not push it. `.claude/scripts/merge-pr.sh`'s union step committed `e20a771` on the branch at 19:13:59Z, and the squash `d8180fd` followed at 19:20:20Z, with no bounce (the merge owner's retro brief). `git show <c>:docs/review-feedback.md | grep -c '^## '`, which also counts the file's four non-entry headings, reads 44 at `f69d224`, 45 at `4f8e6e4`, 45 at main `4fa0840`, and 46 at `e20a771` and `d8180fd`. That matches the lane's trial ("result 46"). The merge owner's retro brief gives the result as 45, a figure the tree does not bear out, and that count is noted on #295. No new signal. Recorded so that a later count of union-at-merge outcomes includes this one.

## 2026-11-02 — PR #450 (unquoted heredoc)

- Phase: process
- Observed: PR #450's body has two edits 30 s apart (`userContentEdits`, 19:20:32Z and 19:21:02Z). In the first, 24 of the `## Lane report`'s 37 backtick spans are gone and in their place is what command substitution printed: nothing for `committed-run.test.ts` or `docs/tech-debt.md`, and for `git diff --name-only origin/main...HEAD` that command's own output, spliced into the "Changed files (pasted …)" line; `git fetch origin` and `git merge-tree` were spans of the same section. The sections above the lane report kept all 182 of their backticks in both edits, and the second edit restored the 24. The lane reported an unquoted heredoc while rewriting the body, nothing written, worktree clean (the merge owner's retro brief). Every span the shell ran here was read-only or wrote only refs, but a lane report quotes commands as its record (a `git diff` range, a `merge-pr.sh` call, a mutant's revert), so the same slip over another span runs that span. `.claude/agents/planner.md` names `<<'EOF'` for its one heredoc; `.claude/agents/ticket-agent.md` § 7 names `gh pr create` and no body form. Weighed as a hook and not filed: one instance, nothing damaged, and the repo's one lexical Bash scan, `.claude/hooks/guard-dirty-revert.sh`, has three open heredoc-parsing defects (#309, #347, #360), so a second scanner keyed on heredoc quoting starts in the same bug class. The narrow candidate if it recurs: a PreToolUse refusal of `gh (pr|issue) (create|edit|comment)` fed by a `<<` whose delimiter is unquoted.

## 2026-11-02 — PR #450 (squash message)

- Phase: merge
- Observed: commit `3976001`'s message says "Every other metric matches both f60add1 and 122c692."; the confirmation pass on `c407485..3976001` noted the claim, and the lane corrected it in the PR body's § Measured ("That holds for `122c692` only") rather than rewriting a pushed commit. `.claude/scripts/merge-pr.sh` merges with `gh pr merge --squash --match-head-commit <sha>` and passes no message (line 1574), so GitHub built `921f670`'s message from the branch's commits: its line 66 is the uncorrected sentence, and the word "Correction" appears nowhere in it. `main`'s history carries the claim the PR retracted, and the retraction is reachable only through the PR. `3976001` is not the commit `eval/reports/c407485.json` names, so a reword would not have broken ADR 0005 § Decision (f)'s lineage; no rule says which of the two a lane does. One ticket so far.

## 2026-11-02 — PR #450 (REBASE bounce)

- Phase: process
- Observed: #443 merged at 18:38:30Z (`2cfea7e`), 2 min after PR #450 went ready (18:36:12Z), adding `misspeltRetrievalRecall` to the report beside this branch's two sentence-kind rows, and the merge owner bounced the lane REBASE (the merge owner's retro brief). The lane merged `origin/main` (`c407485`, 18:48:03Z) so `122c692`, the commit `eval/reports/122c692.json` names, stays in the lineage (ADR 0005 § Decision (f), cited in that commit's body); set `.claude/comment-density.baseline.tsv`'s `eval/src/audit.ts` row by hand to the merged file's measured 486 bp (the branch's row was 476, main's 560; same body); and re-recorded tier 2 once at the merge (`3976001`, 19:14:21Z), a report carrying both sides' rows, which a scoped confirmation on `c407485..3976001` approved. The merge owner's update-branch merge (`8341720`, 19:22:14Z) and the squash (`921f670`, 19:28:38Z) followed: 50 min from the upstream merge to this one. Third ticket, after the `PR #407 (REBASE bounce)` and `PR #443 (REBASE eval run)` entries, where the bounce said REBASE, ADR 0005 (f) said merge and the lane followed the ADR; the merge owner's brief calls the merge the intended shape, and `.claude/agents/ticket-agent.md` § 8's bounce sentence states only the rebase. Three meets this log's threshold: filed as #476 for the owner (agent and skill text). The hand-set baseline row is #402's collision.

## 2026-11-02 — PR #450 (sweep neighbour clause)

- Phase: review
- Observed: the #424 plan's sweep family 2 listed `README.md:5` (its positive control) and `docs/plan.md:9` and classified both "moves"; the lane's rewrite of each kept an interpretation "unless one contradicts it" (`64351b0:README.md` line 5), and the full review pass's FIX-NOW restored #420's amendment that an entailing slide wins (`bd64261`). The plan comment records this as "Missed in the first pass" and the lane's Friction line as the sweep missing two sites; the sites were in the sweep's output, and what was missed was the new text, which restated a neighbouring clause of the same sentence — #420's rule, not the one #424 changed — that no family searched for. The clause the rewrite used is the one `CLAUDE.md:11` still carries ("an interpretation is withheld if one contradicts it"), the humanAlways hit the sweep classified "stands". The review's SYSTEMIC entry in `docs/tech-debt.md` (the entry headed "… is restated at seven sites with no ledger", PR #450) names the root cause; #458 (open) checks how a sweep classifies the hits it leaves, not what it writes at the hits it edits. One ticket so far.

## 2026-11-02 — PR #450 (revisit trigger)

- Phase: process
- Observed: ADR 0009 § Decision (r)'s sentence-kind trigger ("if `sentenceKindPrecision` falls below the verifier's precision on the same run") fired on the first run that measured it, 15/22 against `verifierPrecision` 9/9 at `122c692` (PR body § Measured). The lane filed #459 for the owner, wrote that it did not tune the prompt against the 35-sentence sample because a prompt fitted to the sample would move the figure that measures it, and the PR merged with the trigger standing, since (r) is not a gate. It is the second of (r)'s seven triggers to fire on its first measurement the same day, after #438 (`attributionRecall` 40/47 below `retrievalRecall` 43/47, PR #437); both are open with no comment. The same review's SYSTEMIC entry says `CLAUDE.md`'s "Nothing the tutor says is uncited" is literally false for revision guides since this merge, which the merge owner relayed to the owner (the merge owner's retro brief), and #453 (open) says the same of ADR 0009 § Consequences. Recorded for the owner's queue; no workflow signal.

## 2026-11-02 — PR #454 (new ledger on rebase)

- Phase: merge
- Observed: the #440 lane's new `.claude/ledgers/human-always-paths.ledger` sweeps `\bhumanAlways` and listed `excluded:` for `docs/review-feedback.md` and `docs/friction-log.md`, though the plan comment's own sweep (a) excluded `docs/tech-debt.md` too by pathspec. The lane rebased after #445 (`d8180fd`, 19:20:20Z; rebased commits at 19:21:43Z). #450 then landed `921f670` at 19:28:38Z, adding a tech-debt row that narrates `CLAUDE.md` being humanAlways at line 184 (`d8180fd`'s copy has no `humanAlways`). The push at 19:34:06Z went red in CI run 41511141432 with `ERROR human-always-paths: unlisted hit — docs/tech-debt.md:184`. The lane found the red before the merge owner's FIX bounce arrived and landed `43f10c3` at 19:38:23Z, one `excluded:` line, green in run 41511829836. The cost was one CI run and a commit after the verdict fill (next entry). The lane's note, from the merge owner's retro brief: "a new ledger with a word-level sweep goes red whenever another PR mentions the key in narration — the gate working, but it surfaces only after a rebase". This is the mirror of PR #353's case, which #403 holds: there a ledger new on `main` met a branch's prose, here a branch's new ledger met narration `main` gained after the branch point. #403 (b)'s trial merge before the push would have shown it, since #450 merged 5 min 28 s before the push. Pre-listing the log was also open to the lane at no cost. The `pnpm check:ledgers` gate's format header lets an `excluded:` path go unreturned, and 9 of the 29 ledgers at `d8180fd` list `excluded: docs/tech-debt.md`. Evidence added to #403 (https://github.com/TomBennett-Lloyd/cram.ai/issues/403#issuecomment-6587028543).

## 2026-11-02 — PR #454 (post-fill commit)

- Phase: merge
- Observed: the verdict commit `71362d1` (`approved-no-changes`, quoting "approve 454 and 445") came before `43f10c3`, so the merged head carried a ledger line the owner's approval had not seen. The merge owner's retro brief records the decision to merge on the existing approval because `43f10c3` touched no humanAlways path. Then came `gh pr update-branch` (`a68637b`, 19:45:13Z), run 41512855963 green at 19:50:25Z, and the squash `f7168ab` at 19:50:34Z. `.claude/workflow.json` → `merge.mergeRitual` orders fill, merge, label, and names no arm for a lane commit between the fill and the merge. `merge-pr.sh`'s feedback step reads the branch's added `docs/review-feedback.md` lines for a filled entry, not which head the fill preceded. #416, on the humanAlways list being read at classify rather than for the merging head, is the nearest open issue. The judgement held here (a non-humanAlways commit after the fill rides the approval), and no text states it. One PR so far.

## 2026-11-02 — PR #454 (timeout re-runs)

- Phase: verify
- Observed: the lane report's friction line records the post-rebase `pnpm verify` going red twice on #349's `packages/ingest` timeout under load averages 37–48. The merge owner's retro brief records the FILL's run lost to #441's timeout at load 61, with the one sanctioned re-run green. The diff's only source file is `.claude/scripts/merge-pr.test.sh`, and the lane read CI as the only unloaded arbiter "for a tree whose diff touches no package". This lane joins the ones on 2026-11-02 that the `PR #445 (md-only full tier)` entry lists. #471 does not apply here, because a `.sh` file in the diff calls for the full tier on its own terms. #349 and #441 are both open.

## 2026-11-02 — PR #454 (dispatch refusal)

- Phase: process
- Observed: #440 was filed at 16:15:13Z, and 28 s later its first comment recorded the merge owner's auto-mode classifier refusing the lane's dispatch as self-modification, since the footprint was the session's own permission settings and `.claude/workflow.json`. On the owner's explicit word it was re-dispatched, and the plan comment went up at 16:21:34Z. The cost was about six minutes and an owner message. `.claude/skills/run-issue/SKILL.md` names a classifier refusal only for a lane's FILL or rebase resolution ("returns `BLOCKED` ... you then run the same bare command yourself"), not for the merge owner's own dispatch. From this PR on, `.claude/settings.json` is humanAlways, so a later ticket on it meets the owner at merge anyway. One ticket so far.

## 2026-11-02 — PR #472 (label geometry)

- Phase: implementation
- Observed: the #421 plan comment put `APPEARS_TO_CONTRADICT` in flow at `display: none` and priced the reflow in its Approach ("The cost: the text after the reference shifts while the label shows"). Its Revision 1 (landed in `ca4b0d9`) came after the phone project's Playwright click on the contradiction button missed — the shown label wrapped the cluster and moved the button from under the pointer — and added an e2e assertion that the button's box holds. That assertion, the mutation pass's 15 CSS mutants against Playwright, and browser-smoke's PASS at `6b7f4db` ("the button's box did not change", PR #472's body) each measured that one button; the reviewer's pass on `6b7f4db` found every later control still pushed, a `docs/standards/design.md` rule 6 breach, and Revision 2 (`288e1c5`) holds the label's box at rest with `visibility: hidden` and asserts the sentence's next number holds too. Upstream, ADR 0009 § Decision (i) puts the mark under rules 2 and 9, the issue body cites rules 2 and 11, and `.claude/agents/browser-smoke.md`'s "New chrome answers for itself" bullet names rules 2 and 9; rule 6's text speaks of readouts, columns and a moving cursor, and nothing in the chain named it for a hover reveal. The cost was one finding in a round fixing eight others, and the smoke's geometry reading predates the final geometry (the PR body hands that to the e2e lane). Filed as #474.

## 2026-11-02 — PR #472 (render-deck hook)

- Phase: verify
- Observed: the lane's red `pnpm verify` runs were all the #349/#441 timeout class: `ca4b0d9`'s body records one (`eval/src/ingested-course.test.ts` at 5000 ms, 2.99 s alone, green on the re-run) and `6b7f4db`'s one at load about 35 (ingested-course, `eval/src/render-deck.test.ts` and `packages/ingest`'s stored-text). The lane report's retro line counts three whole re-runs and its friction line two reds in five runs; the merge owner's retro brief has 3 of 9. render-deck fails in its `beforeAll` (line 36, which renders the deck's PDFs) at vitest's default 10000 ms hook timeout, not in the raster cases #200 fixed by construction (PR #249, `d6e1409`). #441's body names only ingested-course; its 17:51Z comment records a render-deck hook timeout from the #411 lane, the `PR #449 (local verify red)` entry a second, and this lane a third, now added to #441 as a comment. With the six lanes the `PR #445 (md-only full tier)` entry lists and the `PR #454 (timeout re-runs)` entry, the eighth lane on 2026-11-02 to pay the class.

## 2026-11-02 — PR #472 (verify wall-clock)

- Phase: verify
- Observed: the lane's friction line reads "at machine load 30–50 the full tier took over 20 minutes", and every run was the full tier (`8b84cd7` and `ca4b0d9` record `tier full`; #402 records that `apps/*` resolves to everything). The lane ran about 3.25 hours of wall clock (the merge owner's retro brief), plan comment at 16:47Z to PR at 19:48Z. Sixth lane to record the composite's cost under shared load (PR #215, PR #386, and the `PR #394 (verify wall-clock)`, `PR #432 (step commits)` and `PR #455 (verify under load)` entries), at the longest per-run figure yet; the earlier figures run from 9 to 15 minutes.

## 2026-11-02 — PR #472 (baseline unbanked)

- Phase: merge
- Observed: the lane report's merge cautions say `.claude/comment-density.baseline.tsv` reports "stale (3 lower)" at the head that merged and was "not banked, to avoid another full run"; the three lowered rows wait for whichever PR next regenerates the file. #402 (open) records a baseline row buying the full composite; here the same price ran the other way, and a ratchet tightening was declined because banking it cost one more 20-minute run. One lane so far.

## 2026-11-02 — PR #472 (hostile corpus)

- Phase: implementation
- Observed: the mutation pass's hostile corpus (14 inputs, judged by `@cram/grounding`'s `claimSpans` and `quotesIn`, the server's code, not the view's) disagreed on two — a line two slides hold, and overlapping quotes — where the view dropped the later quote's mark and number; `6b7f4db` merges overlaps and the corpus agrees 14/14, with 51 of 51 mutants killed and two empty-run guards deleted rather than declared equivalent (PR #472's § Mutation). The defect was found before review, by `.claude/agents/ticket-agent.md` § 4's hostile-corpus rule on a web surface. No new signal; recorded for a graduation check of that rule.
