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

| Captured entry                                                                                     | Now owned by |
| -------------------------------------------------------------------------------------------------- | ------------ |
| architecture.md § Why paraphrases ADR 0002's count without citing it                               | #181         |
| plan.md §8 puts the contradiction set in M2; ADR 0005 puts it in #14                               | #181         |
| ADR 0005 (g) lists the trigger path set its script will own                                        | #181         |
| grading agreement's hand-marked inputs have no delivering ticket                                   | #181         |
| ADR 0004 (h)'s carrier list names a .gitignore phrase and a tech-debt entry that #15 removed       | #181         |
| verify-tier.sh's rung 2 claims verify:full's leg order and does not keep it                        | #292         |
| ADR 0003's restatement ledger does not list #20's new carriers                                     | #298         |
| ADR 0006's carrier ledger names the old home of the quotable field list                            | #298         |
| ADR 0005 cites `citation.ts` for a minting split it no longer states                               | #298         |
| ledger sweeps with only literal arms cannot see a paraphrase                                       | #298         |
| opening a course file to read it can write to it                                                   | #300         |
| a course file whose stored `course_id` fails `CourseId` throws instead of being refused            | #300         |
| a PDF that pdf.js cannot read is reported as damaged, whoever is at fault                          | #301         |
| the PPTX reader finds the presentation part by fixed name, not by relationship                     | #301         |
| pdf.js refuses a `Buffer` that `DeckFile` accepts by type                                          | #301         |
| an eval report's sampling is what the caller says, never what the generator ran                    | #302         |
| nothing owns which text a slide is embedded as                                                     | #302         |
| the generator's context length differs between developer mode and the installed app, with no owner | #302         |
| the quotable fields of a SlideRecord are listed in two packages                                    | #302         |

---

## 2026-10-19 — ingest glues any unmarked line after a bullet onto that bullet

- Where: `bodyOf` in `packages/ingest/src/slide-text.ts`; `TextLine` in `packages/ingest/src/page-text.ts`
- What: an unmarked line after a bullet is read as that bullet's wrapped continuation, because `TextLine` carries no geometry to tell a wrap from a new paragraph. A closing sentence, a source line or a footer after a bullet list ends up inside the last bullet. The text is kept and nothing is split mid-bullet, but the line structure is lost. Suspected root cause: `TextLine` has no x-indent. Adding one changes the boundary #10's PPTX adapter shares.
- Source: issue #9 (review cycle 1)

## 2026-10-20 — the PPTX math fold merges letters whose style carries meaning

- Where: `packages/ingest/src/adapters/pptx/omml.ts` `MATH_ALPHANUMERIC`, `plainLetters`
- What: the fold stores every math alphanumeric as its NFKC form, so `R ∈ ℝ` is stored, quoted and verified as `R ∈ R`, and a bold vector `𝐯` merges with a scalar `v`. Recall was chosen over the distinction (#159's plan comment). The double-struck set letters (`ℕℤℚℝℂ`) are the obvious candidates to exempt. Revisit this when the eval deck gains equations.
- Source: #159 review cycle 1
- Update 2026-10-21 (#194): the fold moved to `packages/ingest/src/stored-text.ts` `storedText`, which every adapter's text passes through, so the merge now holds for PDF text and PPTX prose as well as equations; the Where line names the site it left.

## 2026-10-21 — server tests hand-build the embedder identity

- Where: `apps/server/src/upload.test.ts` `lectureDeckIn`
- What: the test restates the identity formula `embedderIdentity` owns (`apps/server/src/slide-embedding.ts`) and the fixture's private vector dimension as a literal, so a change to either breaks the test with no pointer to the owner. `repair.test.ts` calls `embedderIdentity` instead.
- Source: #147 review cycle 1

## 2026-10-21 — an `aria-disabled` button looks as live as an enabled one

- Where: `apps/web/src/app.css` (`button:disabled` is the only inert-button style); `apps/web/src/shell/async-states.tsx` `Failed`'s Dismiss button
- What: while a dismissal waits, the Dismiss button is `aria-disabled` and ignores presses, because a real `disabled` would drop the focus the reader put on it. No style matches `[aria-disabled='true']`, so it looks fully live. The "Dismissing…" pending label beside it says why. Root cause: the stylesheet has no treatment for an inert button that keeps its focus. Give it one when a second such button appears (`docs/standards/design.md` rule 9).
- Source: #233 review cycle 1 confirmation pass

## 2026-10-21 — the eslint frontend gate refuses copy that only looks like a colour

- Where: the frontend-gate block of `eslint.config.mjs`, its four `no-restricted-syntax` colour selectors
- What: the selectors test every string literal and template element in UI code, so they cannot tell a style value from user-visible copy or a URL. The #273 review measured these as refused: `'Text color(s)'`, `'see lab(3)'`, the anchor `'#add'` and the entity `'&#123;'`. Root cause: the selectors match by node type, not by position. Scoping them to style-bearing positions (a `style`/`fill`/`stroke` attribute, a CSS-in-TS value) would remove the false refusals without opening a way past the gate.
- Source: #273 review cycle 1

## 2026-10-21 — a failed repair's log names the outcome, not the lecture or the cause

- Where: `apps/server/src/course-repair.ts` `repairCourse`, `parseStored`; `apps/server/src/ingest-queue.ts` `#repair`
- What: `rebuildCourse` returns the lecture whose stored deck no longer reads, and ingest says why, but `repairCourse` returns only the status and `parseStored` drops ingest's reason, so the log reads `deck-unreadable` with no lecture or reason (`docs/standards/error-handling.md` rule 4). Root cause: `RepairOutcome` is a bare status, and the log entry has one `outcome` field.
- Source: #299 review cycle 1

## 2026-10-21 — no gate holds a rebuild report across a rename of a discardable table

- Where: `packages/shared/src/ingest-status.ts` `DiscardableTable`; `packages/index/src/schema.test.ts`; `packages/index/src/rebuild-report.ts` `readRebuildReport`
- What: the schema test holds `DiscardableTable` equal to the current schema's discardable tables, so renaming `topics` drops the old name from the vocabulary. An undismissed report a rebuild wrote under that old name is then counted as `OTHER_ROW` (`apps/web/src/copy.ts` `discardedMessage`). `readRebuildReport` also reads an older file's `rebuild_report` with the current reader. Root cause: the report's table names are persisted across app versions, and the vocabulary only knows the current one.
- Source: #299 review cycle 1
