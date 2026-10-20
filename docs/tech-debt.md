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

**Restatement ledger for this file's own path** (`docs/standards/architecture.md` rule 9), which acquired one the first time a site carried it **executably**. A FLOOR, NOT A CENSUS, in both halves. The executable carriers known at porting are two, both added in cumulo by cumulo#513 and carried over with the ported tooling: the `APPEND_ONLY_LOGS` array in `.claude/scripts/merge-pr.sh` (named `TECH_DEBT_PATH` until #60), whose union step matches this exact path to decide whether a merge conflict is the append collision it may resolve, and the `TD` constant in `.claude/scripts/merge-pr.test.sh`, which is what the cases for that step assert against. Both fail quiet-and-closed rather than quiet-and-open — a renamed log stops conflicting under the old name, `git merge-tree` reports the new one, and the conflicted-set test refuses naming it.

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
- What: `docs/standards/architecture.md` rule 9 wants a ledger's sweep to carry a citation arm (`0001-grounding-architecture.md` § Decision (d)) beside the literal arm. Add the arm when the ledger moves to the declared `.claude/ledgers/` form at the first value move.
- Source: #1 review cycle 2
- Update 2026-10-20 (#29): the floor also misses two carriers #8 added, `packages/shared/src/verification.ts` (`Verdict`, `PartialPolicy`) and its test. The recorded sweep returns the first only through its policy arm and the test not at all, because its verdict arm matches the prose list form and not the TypeScript enum form. Both join the ledger when it is declared; #29 holds that acceptance open.

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
- What: a sweep run before the commit that carries its ledger sentence records that commit's parent. It happened (shown at `9d90f16`, whose ledger lists the `docs/adr/README.md` § Index row that is absent at its recorded `5a5f86c`) on ADR 0001 (`bb8a720`) and ADR 0002 (`5a5f86c`, then `9d90f16`, then `15c9b94`). A rebase or squash-merge also leaves the recorded SHA unreachable from the merged history: `git merge-base --is-ancestor 4840fa2 5f4f745` and `git merge-base --is-ancestor 15c9b94 origin/main` both return 1. Fix candidates: record the commit after committing (a two-commit dance), phrase the recipe as "the parent commit of the change that carries this sentence", record a `main` SHA after the merge, or record the merge-base.
- Source: #2 review cycle 1; #4 review cycle 1

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
- Update (2026-10-16, #5): `contradiction-set-bar` ledger — `docs/plan.md`'s §4 metrics line left, replaced by ADR 0005's pointer; §7 item 5 still restates the bar ("the 100% metrics").

## 2026-10-15 — check:no-network-egress exempts a name absent anywhere from the stale check

- Where: `.claude/scripts/check-no-network-egress.sh`, the stale-entry loop over the allow-list
- What: an entry whose name is an absent optional variant under one parent but installed and clean under another reads `absent` rather than stale. On a platform where the variant installs, the scan reports it stale as it should, so CI on that platform still catches it. Keying the exemption on name plus version, or on "no installed occurrence", would close it.
- Source: #18 confirmation pass

## 2026-10-16 — .gitignore's data/ comment paraphrases ADR 0004's unit

- Where: `.gitignore`, the course-content comment above `data/`
- What: "`data/` is where the app keeps uploaded decks and per-course indexes" (wrapped across two comment lines) paraphrases `docs/adr/0004-storage.md` § Decision (a)'s unit without citing it, and is at odds with (a)'s configurable data directory, #15's default under the OS app-data folder, and (b)'s decks stored inside the course file. Pre-existing; the fix belongs with #15's data-directory work.
- Source: #4 review cycle 1

## 2026-10-16 — plan.md §8 puts the contradiction set in M2; ADR 0005 puts it in #14

- Where: `docs/plan.md` §8, the M2 line ("contradiction set"); `docs/adr/0005-evaluation-as-gate.md` § Decision (a) and (h); #14's body ("a first contradiction set")
- What: the milestone line lists the contradiction set as an M2 deliverable, while ADR 0005 and #14 deliver it with the deck under M1. Pre-existing milestone prose, now cited from ADR 0005 § Context and (h), which name §8 M2.
- Source: #5 review cycle 1

## 2026-10-16 — ADR 0005 (g) lists the trigger path set its script will own

- Where: `docs/adr/0005-evaluation-as-gate.md` § Decision (g) (`packages/grounding`, `packages/index`, `packages/gateway`)
- What: (g) names the gate script as the set's only owner, yet lists the members itself. When #47 lands the script, it declares that set's ledger with ADR 0005 (g) as a carrier (already in #47's body); this entry closes when #47 does.
- Source: #5 review cycle 1

## 2026-10-16 — grading agreement's hand-marked inputs have no delivering ticket

- Where: `docs/adr/0005-evaluation-as-gate.md` § Decision (d) (the grading-agreement row) and (h)
- What: the metric needs committed synthetic student answers with per-rubric-point hand marks; (h) gives #14 only the hand labels of `eval/labels/` (the verifier metric's input), and rubric points arrive with M4, so no ticket delivers the marks. Name the ticket when M4's grading work is ticketed (#24 is M4 but does not deliver marks).
- Source: #5 review cycle 2

## 2026-10-16 — plan.md §9 q3 and q4 are listed as open but the owner decided them on 2026-10-13

- Where: `docs/plan.md` §9, questions 3 (Windows testing) and 4 (code signing)
- What: the owner's comment on #7 (2026-10-13) decided both — a free VM on the dev Mac for installer/UI testing with the user's laptop for the performance measurement, and code signing skipped — yet §9 still lists them as open. ADR 0005's review cycle 3 caught a comment restating q3 as open. Either strike the two questions or mark them decided with the #7 cite.
- Source: #5 review cycle 3

## 2026-10-16 — the Closes-keyword parse is embedded twice

- Where: `.claude/scripts/fill-verdict.sh`, the node program in its `pr` step; `.claude/scripts/merge-pr.sh`, `pr_facts`
- What: both scripts embed the same closing-keyword regex in their own `node -e` program, and only a comment in `fill-verdict.sh` keeps the two in step (`docs/standards/structure.md` rule 7). Pulling it out means restructuring `pr_facts`, which also parses lanes, checks and commits, and that does not belong in #50.
- Source: #50 review

## 2026-10-16 — feedbackLogLedger does not list fill-verdict.sh as a prose carrier

- Where: `.claude/workflow.json` → `feedbackLogLedger`; `.claude/scripts/fill-verdict.sh` header
- What: `fill-verdict.sh` reads the path from `feedbackLog`, so it does not carry the path executably. Its header does name `docs/review-feedback.md` in prose, and the ledger, which says it is a floor, does not list it. `.claude/workflow.json` is `humanAlways`, so this waits for the next PR that edits that file anyway.
- Source: #50 review

## 2026-10-16 — merge-pr.sh's `*_RETRIES` knobs count different things

- Where: `.claude/scripts/merge-pr.sh` env knobs block (`MERGE_PR_CONFIRM_RETRIES`, `MERGE_PR_UPDATE_RETRIES`, `MERGE_PR_READ_RETRIES`) and the loops that read them in the merge, issues, update-branch and checks steps
- What: one suffix, three meanings. `MERGE_PR_CONFIRM_RETRIES` is described as "re-reads allowed", but its `attempt=1 … -lt N` loops give N-1 re-reads. `MERGE_PR_UPDATE_RETRIES` counts attempts and says so. `MERGE_PR_READ_RETRIES` counts retries after the first read. Pick one meaning for the whole family, then rename or re-describe the knobs and their loops to match.
- Source: #55 review cycle 1

## 2026-10-16 — the log-path ledgers trail `APPEND_ONLY_LOGS`

- Where: `.claude/workflow.json` → `feedbackLogLedger`; `docs/friction-log.md` (no path ledger); `.claude/scripts/merge-pr.sh` `APPEND_ONLY_LOGS`; `.claude/scripts/merge-pr.test.sh` `RF`, `FL`
- What: `APPEND_ONLY_LOGS` carries `docs/review-feedback.md` executably, but `feedbackLogLedger` names only merge-pr.sh's feedback step. `docs/friction-log.md` has two executable carriers now (the array and the harness's `FL`) plus its prose ones, and no path ledger, which `docs/standards/architecture.md` rule 9 owes from the second carrier. The workflow.json half waits for a PR that is `humanAlways` anyway, beside the fill-verdict.sh entry above.
- Source: #60 review cycle 1

## 2026-10-16 — merge-pr.sh's post-analysis union guards have no case

- Where: `.claude/scripts/merge-pr.sh` `log_union` (the post-merge conflicted-set comparison and the `git diff HEAD --check` refusal); `.claude/scripts/merge-pr.test.sh` step 20
- What: both guards fire only if the tree changes between the merge-tree analysis and the worktree merge, so no fixture reaches them. A mutant that removes the conflicted-set comparison passes every case. Covering them needs a seam between the two steps. This predates #60, which rewrote the comparison as a sorted-set check.
- Source: #60 review cycle 1

## 2026-10-19 — ADR 0005 § Context says #31 is open

- Where: `docs/adr/0005-evaluation-as-gate.md` § Context, the sentence beginning "The eval deck is authored as text"
- What: it states that #31 is open on how ingest adapter tests get binary inputs. #31's PR decides it (an exemption in `.claude/scripts/check-no-course-content.sh` for provenanced synthetic ingest fixtures), so the sentence is a stated fact gone stale, which `docs/adr/README.md` § Amendments lets the next amendment of ADR 0005 true. The eval deck's own decision is unchanged: it stays authored as text.
- Source: #31 review

## 2026-10-19 — two minters of `SourceId` are licensed, one exists

- Where: `packages/shared/src/citation.ts` `SourceId` docblock; `packages/index/src/slide-row.ts` `sourceIdOf`
- What: the docblock gives minting to ingest and the index (#10, #11). `sourceIdOf` now mints `<lectureId>/<slideNo>`; if ingest (#9, #10) mints its own format, citations and index rows stop agreeing. Ingest should call `sourceIdOf`, or the docblock should name one owner.
- Source: #11 review cycle 1

## 2026-10-19 — nothing says when a feature PR banks comment-density rows

- Where: `.claude/scripts/check-comment-density.sh` header (BASELINE, `--ratchet`); `.claude/comment-density.baseline.tsv`
- What: an unbanked file is admitted at or below the median of the committed rows, so banking a lane's below-median rows lowers the bar for every other lane, and no lane has a reason to bank. Unbanked files can then rise to the median without failing. #11 left its nine rows unbanked for that reason.
- Source: #11 review cycle 1

## 2026-10-19 — no single writer per course file during `reembedCourse`

- Where: `packages/index/src/open-course.ts` `reembedCourse`; `packages/index/src/course-index.ts` `CourseIndex.replaceEmbedder`
- What: a second connection writing slides while `embed` is awaited makes `replaceEmbedder` throw "no embedding for …", which reads as a caller bug, and a write after the swap fails in vec0 because that connection still holds the old embedder. One owner per open course file belongs to the server (#15).
- Source: #11 review cycle 1

## 2026-10-19 — `EmbedSlides` can only fail by rejecting

- Where: `packages/index/src/open-course.ts` `EmbedSlides`
- What: the gateway's expected failures (backend down, rate-limited) will be values once #12 defines its failure type (`docs/standards/error-handling.md` rule 1); this signature then needs a value arm, and `reembedCourse` a result for it.
- Source: #11 review cycle 1
- Update 2026-10-19 (#12): `packages/gateway/src/model-gateway.ts` `Embedder.embed` has no failure value; the encoders run in-process, so only `Generator.chat` returns one (`backend-failed`). This entry stands only if #66's adapter finds an expected encoder failure.

## 2026-10-19 — topic tags are bare strings

- Where: `packages/index/src/course-index.ts` `CourseIndex.setTopics`, `CourseIndex.slidesTagged`
- What: a blank or untrimmed tag is accepted. A `TopicTag` schema belongs in `@cram/shared` (`docs/standards/architecture.md` rule 2), for the ticket that builds the tag pass (`docs/plan.md` §3.2).
- Source: #11 review cycle 1

## 2026-10-20 — no owner says whether an in-text slide attribution is a claim the verifier judges

- Where: `docs/adr/0001-grounding-architecture.md` § Decision (d); `eval/labels/verifier.jsonl` (its first label, reworded to "Your slides say worker bees are male." to avoid the question)
- What: a unit reading "lecture 4, slide 12 says …" (the reporter phrasing `CLAUDE.md` § Hard constraints uses) names a lecture its quotes cannot show, and resolution checks only `sourceId` and quote. Whether the verifier treats the attribution as a claim or ignores it as framing is unowned; #13's claim split, or an ADR 0001 amendment, decides, and the hand labels follow.
- Source: #14 review cycle 1
- Update 2026-10-20 (#13): the generation and rewrite prompts (`packages/grounding/src/prompts/generation-prompt.ts`, `packages/grounding/src/prompts/rewrite-prompt.ts`) ask for no lecture or slide name in a unit's text, and `splitClaims` (`packages/grounding/src/claims.ts`) strips nothing. Whether the verifier credits a frame the model writes anyway is still unowned.

## 2026-10-20 — mustNotContain and resolution normalise whitespace but not typographic apostrophes

- Where: `docs/adr/0005-evaluation-as-gate.md` § Decision (c); `docs/standards/grounding.md` rule 3; `eval/src/golden-question.ts` `firstForbiddenEntry`
- What: an entry such as `can't see red` misses a model's U+2019 `can’t`, and a model quote of "tomorrow’s weather" would be withheld as `dangling-citation` against the deck's straight apostrophe. The fix is a decision for the matching rule's owners (ADR 0005 (c) for `mustNotContain`, #13 for resolution), not for the fixture.
- Source: #14 review cycle 1
- Update 2026-10-20 (#13): resolution's half is decided. `resolveCitations` (`packages/grounding/src/resolve-citations.ts`) normalises whitespace only, as `docs/adr/0001-grounding-architecture.md` § Decision (c) fixes it, so a typographic-apostrophe quote is withheld. Widening it is an amendment of that ADR. The `mustNotContain` half stays open for ADR 0005 (c).

## 2026-10-20 — the contradiction set's caveat phrasings are copied per item with no owner

- Where: `eval/questions.jsonl`, the trailing `in reality`, `misconception`, `mainstream` and `contrary to` entries of every cited contradiction item
- What: one intent, many copies (`docs/standards/structure.md` rule 7), and the line schema ADR 0005 (c) fixes cannot share them. The set is also narrow for ADR 0001 § Context's unsolicited caveat: it holds no `actually`, `in fact` or `commonly believed`. Either an `auditEvalCourse` arm asserting every cited item carries the same caveat set, or an ADR 0005 (c) amendment.
- Source: #14 review cycle 1

## 2026-10-19 — ingest glues any unmarked line after a bullet onto that bullet

- Where: `bodyOf` in `packages/ingest/src/slide-text.ts`; `TextLine` in `packages/ingest/src/page-text.ts`
- What: an unmarked line after a bullet is read as that bullet's wrapped continuation, because `TextLine` carries no geometry to tell a wrap from a new paragraph. A closing sentence, a source line or a footer after a bullet list ends up inside the last bullet. The text is kept and nothing is split mid-bullet, but the line structure is lost. Suspected root cause: `TextLine` has no x-indent. Adding one changes the boundary #10's PPTX adapter shares.
- Source: issue #9 (review cycle 1)

## 2026-10-20 — a UTF-16 PPTX part is reported as damaged

- Where: `decodeUtf8` and `readXml` in `packages/ingest/src/adapters/pptx/ooxml.ts`
- What: OPC permits XML parts encoded in UTF-16, but every part is decoded as fatal UTF-8. A conforming UTF-16 part (BOM `FF FE`) therefore comes back as `damaged`, which blames the deck for the reader's limit (`docs/standards/error-handling.md` rule 1, blame tiebreak). It is a value with an honest detail, and PowerPoint writes UTF-8. Sniffing the BOM is the fix if a real deck ever shows one.
- Source: #10 review cycle 1

## 2026-10-20 — PdfUnreadableReason is hand-written beside the mapping that produces it

- Where: `PdfUnreadableReason` and `UNREADABLE` in `packages/ingest/src/adapters/pdf/ingest-pdf.ts`
- What: the exception enum and the `UNREADABLE` record are compile-checked against each other, and so are the record and the union. A member added to the union with no exception mapped to it still type-checks, though, and consumers get a dead arm. Deriving the union from `UNREADABLE`'s values (`as const satisfies Record<…>`) closes that direction.
- Source: issue #9 (confirmation pass)

## 2026-10-19 — a generator prompt past the server's context is trimmed silently

- Where: `packages/gateway/src/adapters/openai-http/chat-completion.ts` `chatCompletionBody`; `packages/gateway/src/adapters/openai-http/openai-http-generator.ts` `OpenAiHttpGenerator.reply`
- What: the OpenAI-compatible API cannot set Ollama's context length (its `docs/api/openai-compatibility.mdx`, "Setting the local context size"), and Ollama trims messages that do not fit, logging only at debug level. The adapter reads no `usage.prompt_tokens`, so a long retrieved context can reach the model cut short with nothing reported (`docs/standards/error-handling.md` rule 5). The context is #20's Modelfile setup to fix, and the prompt budget is #13's.
- Source: #12 review cycle 1
