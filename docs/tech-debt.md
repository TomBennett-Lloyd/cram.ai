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
| no single writer per course file during `reembedCourse`                                      | #147         |

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

## 2026-10-20 — the PPTX math fold merges letters whose style carries meaning

- Where: `packages/ingest/src/adapters/pptx/omml.ts` `MATH_ALPHANUMERIC`, `plainLetters`
- What: the fold stores every math alphanumeric as its NFKC form, so `R ∈ ℝ` is stored, quoted and verified as `R ∈ R`, and a bold vector `𝐯` merges with a scalar `v`. Recall was chosen over the distinction (#159's plan comment). The double-struck set letters (`ℕℤℚℝℂ`) are the obvious candidates to exempt. Revisit this when the eval deck gains equations.
- Source: #159 review cycle 1
