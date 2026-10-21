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

## 2026-10-21 — PR #248

- Phase: planning
- Observed: the #231 lane's plan comment described its first design (a stub that returned a `holdAsk()` closure) in detail; review replaced it with a named option under `docs/standards/structure.md` rule 2, and the plan comment then cost two confirmation rounds of prose drift, because struck text beside new text read as still live and only rewriting the sections whole passed. One ticket so far on a plan comment that commits to a shape before review has seen it.

## 2026-10-21 — PR #246

- Phase: process
- Observed: the merge owner's dispatch note for #234 named `docs/standards/structure.md` as the authority for a rule it does not state (nothing forbids keeping an unused branch for a future caller); the lane's first plan draft cited it before checking and corrected itself before the first edit. Second instance of a claim in a dispatch note reaching a lane unchecked (PR #86's precedent was the first, consumed into the four-field rule); this one rode in the overlap note, which the four-field rule allows.

## 2026-10-21 — PR #255

- Phase: implementation
- Observed: every `pnpm verify` in the #183 lane ran the full tier because a `.ledger` file in the change set is a type `verify-tier.sh` cannot classify, and one run was re-run whole after the gateway timing flake #243 owns. A ledger line is the cheapest edit in the repo and buys the most expensive tier. One ticket so far; the classifier's docblock owns which extensions resolve to which rungs.

## 2026-10-21 — PR #260

- Phase: implementation
- Observed: the #194 lane could not bank one file's comment-density drop inside its ticket, because `check-comment-density.sh --ratchet` writes a row for every unbanked file in the repo on the same run (151 here), and the lane reverted the run rather than carry 151 unrelated rows in a feature PR. Second instance of the baseline shaping a lane's choices (PR #73's entry was the first, captured into #187); PR #252 banks every file's row, which removes the unbanked rows a later `--ratchet` would sweep in. Nothing to change while that PR waits for the owner.

## 2026-10-21 — PR #262

- Phase: verify
- Observed: every `.sh` edit in the #180 lane sent `pnpm verify` to the full tier (about 10 min under load), and the lane ran its mutants through a scratch case-trimmer because `merge-pr.test.sh` has no case filter and a whole run takes about 2.5 min. Second instance of a cheap edit buying the most expensive tier (PR #255's `.ledger` line was the first); `verify-tier.sh`'s docblock owns which extensions resolve to which rungs.

## 2026-10-21 — PR #263

- Phase: implementation
- Observed: the #233 plan split the shared `IngestStatus` shape change (step 2) from the web consumer that answers it (step 3), and the lane had to land both in one commit because `pnpm verify` is whole-repo and the web package is red between them. A plan step that changes a shared type is not committable on its own; nothing in `.claude/agents/planner.md` asks whether a step's `Verify:` can pass before its consumers move. One ticket so far.

## 2026-10-21 — PR #264

- Phase: verify
- Observed: `pnpm verify` in the #209 lane went red twice on the gateway clock assertion #243 owns, with a rerun green each time, on a diff that cannot reach `packages/gateway`. Third rerun that flake has cost today (PR #255 took one), about ten minutes each under load; #243 is dispatched.

## 2026-10-21 — PR #267

- Phase: planning
- Observed: the #254 lane pasted its restatement sweep's output into the plan comment from memory before running the command, and dropped a line; it noticed and fixed the comment before the first edit. `.claude/agents/ticket-agent.md` § 2 asks for the command and its output, and the output it got was a recollection. One ticket so far.

## 2026-10-21 — PR #270

- Phase: planning
- Observed: the #247 plan's restatement sweep missed `docs/friction-log.md:120`, a dated and still-true carrier of #228's mechanism, because its claim family was the test's wording and not the behaviour ("pressed Tab before the answer rendered"); no edit turned out to be owed. Second sweep-shape miss today after PR #267's (an output pasted before its command ran); both were caught inside the lane.

## 2026-10-21 — PR #272

- Phase: review
- Observed: the #243 lane quoted one earlier run's figure as the 10/10 control reading because its loop had not printed values; the reviewer caught it and the lane re-ran and pasted the readings. One ticket so far on a loop whose output was summarised before it was captured.

## 2026-10-21 — PR #271

- Phase: implementation
- Observed: the #241 lane's mutant loop killed every mutant of the paren counter it wrote and still shipped a counter too broad for `${b%(*}`, because mutating a guard's edges exercises the inputs it has and never the inputs it should have excluded; the reviewer's side-by-side probe of the old and new hook over a hostile corpus found it, at the cost of one review cycle. Same shape as PR #90's (a guard that did not exist): `.claude/agents/ticket-agent.md` § 4's mutation pass cannot find a missing exclusion. Second instance.

## 2026-10-21 — PRs #266 and #269

- Phase: process
- Observed: two REBASE bounces from the merge owner stated the expected `docs/tech-debt.md` heading count one too high, because the count came from `gh pr diff <n> | grep '^[-+]## '` over the whole diff, which also returns `docs/review-feedback.md`'s entry heading; both lanes corrected the figure from their own `comm` run. The per-file form (`git diff <base> <branch> -- docs/tech-debt.md`) is the one the bounce needs. Two instances in one morning, both harmless because the lane's arithmetic is the check, not the bounce's.

## 2026-10-21 — PR #278

- Phase: implementation
- Observed: the #258 lane's first ESLint probe placed every colour at a string's start or end, so four anchoring mutants survived until the reviewer tried them; the grammar the lane listed for its mutation pass was property and value forms, with no axis for where the colour sits in the string. One ticket so far on a grammar list that omits a position axis.

## 2026-10-21 — PR #277

- Phase: review
- Observed: #254 merged mid-lane and changed stored output, which falsified the #257 plan's "no bump owed"; the reviewer found it by reading `origin/main`, a base the lane may not rebase onto unprompted, so the fact reached the lane at review rather than at the plan, and the rebase round then ran twice because #275 merged during the first. The lane also flagged one message-only `git commit --amend --no-verify`, used to reword a replayed commit whose body line began `#254` and so tripped the `^[#;]` body check; the tree had already passed verify and the final verify and CI ran on it. One ticket so far on each.

## 2026-10-21 — PR #284

- Phase: implementation
- Observed: the #256 lane's scripted exact-string edit of the PPTX corpus matched nothing (it keyed on a decomposed "Café" the file did not hold) and passed silently, so the commit's subject claimed "both formats" for a change that reached one; review caught it and the fix commit corrected the record. One ticket so far on a scripted edit with no asserted match count.

## 2026-10-21 — PR #285

- Phase: planning
- Observed: the #273 lane's restatement sweep searched for the two colour-pattern lists it was merging and not for the rule whose scope the `var()` change widened, so three comments describing that rule went stale until review; the reviewer also found a ledger owed under `docs/standards/architecture.md` rule 9 that the plan had declared unnecessary. Third sweep-shape miss today (PRs #267 and #270 were the others), each a different shape: output before command, claim family too narrow, and now the list swept but not the rule.

## 2026-10-21 — PR #289

- Phase: implementation
- Observed: the #268 lane found that diffing the old hook's verdicts against the new one's over a corpus shows which verdicts changed and not whether each change is a fix or a regression; it settled each by running the command under `zsh -fc` with a stub `git` and reading whether the revert ran, which also established that the Bash tool's shell on this machine is zsh. The same lane spent one serial mutant run (about 15 min) before parallelising the loop. Two instances today of a hook change needing ground truth from the shell rather than from the previous hook (PR #271's reviewer probe was the first).
