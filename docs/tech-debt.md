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

| Captured entry                                                                               | Now owned by |
| -------------------------------------------------------------------------------------------- | ------------ |
| architecture.md § Why paraphrases ADR 0002's count without citing it                         | #181         |
| plan.md §8 puts the contradiction set in M2; ADR 0005 puts it in #14                         | #181         |
| ADR 0005 (g) lists the trigger path set its script will own                                  | #181         |
| grading agreement's hand-marked inputs have no delivering ticket                             | #181         |
| ADR 0004 (h)'s carrier list names a .gitignore phrase and a tech-debt entry that #15 removed | #181         |
| check:no-network-egress's `--depth Infinity` is pinned by no test                            | #182         |
| check:no-network-egress exempts a name absent anywhere from the stale check                  | #182         |

---

## 2026-10-15 — verify-tier.sh's rung 2 claims verify:full's leg order and does not keep it

- Where: `.claude/scripts/verify-tier.sh` — the RUNG 2 header ("The legs are emitted in `verify:full`'s own order") against `build_source_prose_legs`
- What: `build_source_prose_legs` appends `check:ledgers` before `check:adr-index` and the observing tests after every `check:*` leg, while `verify:full` in `package.json` runs `test`, then `check:adr-index`, then `check:ledgers`. A red under rung 2 can therefore stop at a different leg than the composite would. Either reorder the builder or delete the claim.
- Source: #17 review (found while adding `check:no-course-content` to the `.md`-conditional legs; pre-existing on main)

## 2026-10-19 — ingest glues any unmarked line after a bullet onto that bullet

- Where: `bodyOf` in `packages/ingest/src/slide-text.ts`; `TextLine` in `packages/ingest/src/page-text.ts`
- What: an unmarked line after a bullet is read as that bullet's wrapped continuation, because `TextLine` carries no geometry to tell a wrap from a new paragraph. A closing sentence, a source line or a footer after a bullet list ends up inside the last bullet. The text is kept and nothing is split mid-bullet, but the line structure is lost. Suspected root cause: `TextLine` has no x-indent. Adding one changes the boundary #10's PPTX adapter shares.
- Source: issue #9 (review cycle 1)

## 2026-10-20 — ADR 0003's restatement ledger does not list #20's new carriers

- Where: `docs/adr/0003-model-roles-and-backends.md` § Decision (m); `README.md` § Local model backend, `.claude/scripts/models-pull.sh`, `.claude/scripts/models-pull.test.sh`, `.claude/scripts/ollama-pin.sh`
- What: (m) is still the undeclared prose form, and its sweep now returns these four files, which state (c)'s rule that developer mode's generator runs on Ollama. The ADR is a `humanAlways` path, and its list changes only at its next amendment (`docs/standards/architecture.md` rule 9), so the files wait for that amendment to be listed.
- Source: #20 review cycle 1

## 2026-10-20 — the generator's context length differs between developer mode and the installed app, with no owner

- Where: `.claude/scripts/models-pull.sh` (Modelfile `num_ctx`); the installed app's generator backend (#7)
- What: developer mode serves the artefact's trained context length, and Ollama sizes the KV cache to it when the model loads. The installed app's context will be chosen under A3's memory budget (#7). Nothing owns the value both modes should share, and the prompt budget (#13) has to fit the smaller of the two.
- Source: #20 review cycle 1

## 2026-10-20 — the quotable fields of a SlideRecord are listed in two packages

- Where: `packages/shared/src/quotable-text.ts` `slideFields`; `packages/index/src/confirmation.ts` `textHashOf`
- What: `slideFields` decides which fields a quote resolves against (title, body, speaker notes, image captions), and `textHashOf` hashes those same fields to decide when a confirmation of derived text is void (`docs/adr/0006-image-only-slides.md` § Decision (g)). The two must change together. If `slideFields` gained a field and `textHashOf` did not, an edit to quotable text would leave the confirmation standing. `slideFields` is the single owner in `@cram/shared` since #202, which moved `@cram/grounding`'s `slideText` and `apps/web`'s quote marks onto it; `textHashOf` still lists the fields itself.
- Source: #109 review

## 2026-10-20 — an eval report's sampling is what the caller says, never what the generator ran

- Where: `eval/src/run-eval.ts` (`EvalRunFacts.sampling`), `eval/src/recording-gateway.ts` (`RecordingGatewaySpec.sampling`), `packages/gateway/src/fake-gateway.ts` (`FakeGatewaySpec.sampling`)
- What: the generator's sampling settings are passed in three times by the caller and never read from the generator that ran. Pins are read from the gateway, so they are the ones that ran (ADR 0003 § Decision (e)). Sampling is not, so a report can record determinism settings that never ran. Suspected root cause: `Generator` does not expose its sampling, which is the gateway's surface (#12, #66); the eval CLI that builds the live gateway is #134.
- Source: PR for #133 (review pass 1)

## 2026-10-20 — nothing owns which text a slide is embedded as

- Where: `eval/src/index-retriever.ts` (`IndexRetriever.open`), `packages/index/src/open-course.ts` (`EmbedSlides`, `embedSlides`)
- What: `IndexRetriever` embeds each slide as `@cram/grounding`'s `slideText`. `@cram/index` takes an `EmbedSlides` callback and has no production caller yet, so the server's ingest path chooses again. If the two choices differ, recall@k measures a retrieval the app does not run. `IndexRetriever` also restates `embedSlides`'s vector-count check, which `@cram/index` does not export.
- Source: PR for #133 (review pass 1)

## 2026-10-20 — the PPTX math fold merges letters whose style carries meaning

- Where: `packages/ingest/src/adapters/pptx/omml.ts` `MATH_ALPHANUMERIC`, `plainLetters`
- What: the fold stores every math alphanumeric as its NFKC form, so `R ∈ ℝ` is stored, quoted and verified as `R ∈ R`, and a bold vector `𝐯` merges with a scalar `v`. Recall was chosen over the distinction (#159's plan comment). The double-struck set letters (`ℕℤℚℝℂ`) are the obvious candidates to exempt. Revisit this when the eval deck gains equations.
- Source: #159 review cycle 1

## 2026-10-21 — line widths and layout measures have no token category

- Where: `apps/web/src/app.css` (the `calc(var(--space-1) / 4)` border widths, the `text-decoration-thickness` of `mark`, and the raw `rem` measures on `.app-header, .screen`, `.slide-card` and `.slide-dialog`); `packages/ui/src/styles.css` (the ring's `outline-width` and `outline-offset`)
- What: `@cram/ui`'s tokens have spacing, type and radius scales only, so line weights borrow fractions of `--space-1` (retuning spacing re-weights every border) and layout measures are raw lengths the gate cannot see — the residual `stylelint.config.mjs` already documents. Root cause: no line-width or measure category in `packages/ui/src/tokens/tokens.css`.
- Source: #16 review cycle 1; #209

## 2026-10-21 — no test holds a decks-screen retry keeping the batch's refusals

- Where: `apps/web/src/decks/DecksScreen.tsx` `reread`; `apps/web/src/decks/DecksScreen.test.tsx`
- What: a retry after a failed status read keeps the last upload batch's refusals in the panel's alert, but the tests cover refusals and a failed read separately, so reverting `reread` to clear them passes every test.
- Source: #16 confirmation pass 2

## 2026-10-21 — opening a course file to read it can write to it

- Where: `apps/server/src/course-file.ts` `openForRead`, `storedLectures`; `packages/index/src/open-course.ts` `openCourse`
- What: `openCourse` sets `journal_mode = WAL` and creates the schema in a blank file, so a 0-byte course file (a crash between creating the file and committing its schema) is initialised by a GET: the ask path, and since #146 the ingest status `useIngestStatus` polls (`apps/web/src/decks/use-ingest-status.ts`). Root cause: `@cram/index` has no read-only open that classifies a blank file instead of creating its schema.
- Source: #146 review cycle 1

## 2026-10-21 — the web shows `@cram/index` status codes to the student

- Where: `apps/web/src/copy.ts` `fileUnopened` and its callers (`refusalMessage`'s `course-unavailable`, `progressMessage`'s `course-unavailable`, `storedUnavailableMessage`, `repairFailedMessage`)
- What: an unopenable course file is reported as "This course’s file can’t be opened (embedder-mismatch)", the raw `OpenCourseResult` status, with no words for what it means or what to do. Root cause: no mapping from `@cram/index`'s vocabulary to student-facing copy. #147 (rebuild or re-embed on course-unavailable) changes what the student can do about each one.
- Source: #146 review cycle 1
- Update 2026-10-21 (#147): the server now repairs both codes at start (`repairCourse` in `apps/server/src/course-repair.ts`), with no action from the student. Either code still reaches the student until a repair has rebuilt or re-embedded the file: while the repair is queued or running, and after any repair that ends any other way. #225 owns reporting the repair.
- Update 2026-10-21 (#225): the decks screen now reports the repair (`CourseRepair` in `packages/shared/src/ingest-status.ts`). While a repair is queued or running it says the stored decks are being updated, with no code shown. `discardedMessage` maps `@cram/index` table names to student words by string, the same gap for a second vocabulary.

## 2026-10-21 — every start-up repair failure is logged as `Error`

- Where: `apps/server/src/course-repair.ts` `parseStored`; `packages/index/src/rebuild-course.ts` `ParseDeck`, `writeRebuilt`
- What: a stored deck that no longer reads is an expected failure, but `ParseDeck` has no value arm for it, so `parseStored` throws. `rebuildCourse` then wraps every per-lecture failure in a plain `Error`. The log therefore cannot tell an unreadable deck, an over-length slide and a backend that is down apart: all three are `outcome: 'Error'`. Root cause: `ParseDeck` and `EmbedSlides` fail only by rejecting. #184 covers the `EmbedSlides` half.
- Source: #147 review cycle 1

## 2026-10-21 — pdf.js refuses a `Buffer` that `DeckFile` accepts by type

- Where: `packages/ingest/src/adapters/pdf/ingest-pdf.ts` `ingestPdf`; its callers' workarounds in `apps/server/src/http-body.ts` `readBody` and `apps/server/src/course-repair.ts` `parseStored`
- What: `DeckFile.bytes` is typed `Uint8Array`, and a `Buffer` passes that type, but pdf.js rejects one at runtime. Each caller re-wraps its bytes as a plain view and restates why. A `slice()` on a `Buffer` returns a view, not a copy. Root cause: the adapter does not normalise its own input. Once it does, both workarounds and their prose can go.
- Source: #147 review cycle 1

## 2026-10-21 — server tests hand-build the embedder identity

- Where: `apps/server/src/upload.test.ts` `lectureDeckIn`
- What: the test restates the identity formula `embedderIdentity` owns (`apps/server/src/slide-embedding.ts`) and the fixture's private vector dimension as a literal, so a change to either breaks the test with no pointer to the owner. `repair.test.ts` calls `embedderIdentity` instead.
- Source: #147 review cycle 1

## 2026-10-21 — a rebuilt lecture's fallback title comes from its stored title, not its file name

- Where: `apps/server/src/course-repair.ts` `parseStored`; `packages/shared/src/deck.ts` `Deck`; `packages/ingest/src/deck.ts` `fileStem`
- What: `Deck` does not store the uploaded file name, so a rebuild passes the stored title through `fileStem` as the title fallback. If a title came from the first slide and contains `/`, `\`, `-` or `_`, and a later ingest no longer reads a title from that slide, the rebuilt title is mangled ("Cells/Tissues" becomes "Tissues"). This can only happen across an ingest change, which is exactly when rebuilds run. Root cause: the stored deck drops the file name.
- Source: #147 review cycle 1

## 2026-10-21 — a new discardable table reaches the student as "other saved items"

- Where: `apps/web/src/copy.ts` `DISCARDED_ROW`, `discardedMessage`; `packages/index/src/rebuild-course.ts` `discardedTables`
- What: `docs/adr/0004-storage.md` § Decision (d) requires a rebuild to tell the user which derived data did not survive. The web names only the tables it has words for. A table added later, such as attempts or notes, is summed as `OTHER_ROW` with every test green. The `topics-table` and `confirmations-table` ledgers only notice a rename, not an addition. Root cause: nothing shared lists the tables a rebuild can discard, so no gate asks for the new table's student words.
- Source: #225 review cycle 1

## 2026-10-21 — ADR 0006's carrier ledger names the old home of the quotable field list

- Where: `docs/adr/0006-image-only-slides.md` § Decision (k), the "Code carriers citing by number" bullet; `packages/shared/src/quotable-text.ts` `slideFields`
- What: the bullet lists `packages/grounding/src/slide-text.ts` as the carrier that makes `imageCaptions` part of the text a quote resolves against. Since #202 that file builds `slideText` from `slideFields`, which is now the carrier, and the ADR's recorded sweep no longer finds `packages/grounding/src/slide-text.ts` or `apps/web/src/ask/quote-marks.ts` while `packages/shared/src/quotable-text.ts` and its test are unclassified. The claim still holds through `slideFields`; only the site is stale. The ADR is humanAlways, so its next amendment should correct the entry.
- Source: #202 review cycle 1

## 2026-10-21 — ADR 0005 cites `citation.ts` for a minting split it no longer states

- Where: `docs/adr/0005-evaluation-as-gate.md` § Decision (c), the `expectedCitations` sentence; `packages/shared/src/citation.ts` `SourceId`
- What: the ADR says golden questions never name a minted `SourceId` "because `packages/shared/src/citation.ts` leaves minting to ingest and the index". Since #183 that docblock names `sourceIdOf` in `packages/index/src/slide-row.ts` as the one minter, so the ADR cites a file for a claim the file no longer makes. The decision still stands (a golden question stays independent of how the index mints); only the cited reason is stale. The ADR is humanAlways, so its next amendment should correct the sentence.
- Source: #183 review cycle 1

## 2026-10-21 — a course file whose stored `course_id` fails `CourseId` throws instead of being refused

- Where: `packages/index/src/open-course.ts` (the `course_id` read), `packages/index/src/rebuild-course.ts` `rebuildCourse` (`CourseId.parse` of the old file's `course` row)
- What: both parse a course file's stored `course_id` through `CourseId` and let the `ZodError` escape. Since #183 tightened `CourseId` to the file-safe rule, an id the old schema accepted (`Bio`, `course_b`) throws where it used to reach `course-mismatch`. No production path writes such a row, since every id was already file-safe at the server, but a course file is external input, and the module that reads it should refuse a malformed row as a value (`docs/standards/error-handling.md` rule 1), not throw.
- Source: #183 review cycle 1

## 2026-10-21 — ledger sweeps with only literal arms cannot see a paraphrase

- Where: the `course-id-length`, `topics-table` and `network-egress-allowlist-path` ledgers under `.claude/ledgers/`, each one's `sweep:` line
- What: each sweep matches the owning identifier and the ledger's own path, but has no claim arm and no numeric arm, which `docs/standards/architecture.md` rule 9 asks for. A later carrier that states the value in words or as a bare number joins the claim without joining the ledger, and `check:ledgers` stays green. The #183 review ran both arms by hand for the course-id length and found no unlisted carrier, so the gap is latent.
- Source: #183 review cycle 1
