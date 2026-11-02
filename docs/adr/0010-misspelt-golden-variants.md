# 0010 — Misspelt golden variants: retrieval-only typos on a golden question, and their recall@k beside the clean figure

- **Status:** proposed
- **Date:** 2026-11-02
- **Issue:** #395

## Context

The owner's direction, 2026-10-21: "we also need to handle typos in the question". #393 shipped the correction. A question token that is not a course term is corrected against the course's own vocabulary, within the bound that `MAX_EDITS` and `MIN_TERM_LENGTH` in `packages/index/src/spelling-correction.ts` set. The eval's retriever takes the same path (`IndexRetriever.retrieve`, `eval/src/index-retriever.ts`), so tier 2 already measures what ships. What tier 2 cannot yet show is whether a misspelt question still finds its slides. Every golden question is spelt correctly.

`docs/adr/0005-evaluation-as-gate.md` § Decision (c) fixes the fields of an `eval/questions.jsonl` line, and its (d) owns the metric table. A misspelt question needs a field, and its recall needs a row. 0005 (c) says that a metric needing a field "adds it by amendment". `docs/adr/README.md` § Amendments (owner decision 2026-10-20, #114) is later and narrower. It allows an amendment only for a stated value that moved or was wrong, and it says "an amendment never touches reasoning". A new field and a new row are a new decision, not a moved value. Two ADRs have already added eval rows in 0005 (d)'s shape without editing 0005: `docs/adr/0006-image-only-slides.md` § Decision (h) and `docs/adr/0009-explanation-answers.md` § Decision (o). **This ADR extends 0005 (c) and (d) in the same way, and 0005 is not edited.** The owner chose this form on 2026-11-02 (#395's plan comment).

## Decision

- **(a) Representation.** A golden question may carry `misspelt`, an array of non-blank strings, defined in `GoldenQuestion` (`eval/src/golden-question.ts`). An absent field means the question has no variants.
  - A variant is the question's text with one or two edits in a word the deck uses. The lexicon is the deck's vocabulary, so a typo in a word no slide holds measures nothing.
  - A variant shares its question's `expectedCitations`, has no `mustNotContain` of its own, and is never read by 0005 (b)'s pass condition.
  - It is retrieved only: it is never asked of the generator and never verified.
  - **A variant is not a golden question.** 0005 (c)'s "`question` is the text asked", 0005 (e)'s run, and 0009 (o)'s "the runner asks every golden question" all stay true as written.
- **(b) Which questions carry variants.** Only questions with non-empty `expectedCitations`. Variants are a sample, not one per question. The sample holds at least one variant per edit kind (substitution, transposition, missing letter), at least one two-edit variant within the corrector's bound, and at least one beyond it, so that the row can read below its maximum. The bound is cited here by symbol and carries no literal. The committed sample lives in `eval/questions.jsonl` and in #395's PR body.
- **(c) The audit.** `auditEvalCourse` (`eval/src/audit.ts`) gains two problems:
  - `variant-of-uncovered`: a variant on a question with empty `expectedCitations`;
  - `duplicate-variant`: a variant equal, under 0005 (c)'s case-insensitive, whitespace-normalised matching, to its own question, to another question, or to another variant.

  A variant needs no citation check, because it shares its question's citations.

- **(d) The metric row**, in 0005 (d)'s shape:

  | Metric                      | Numerator over denominator                                                                                                                   | Tier   | Bar      |
  | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
  | Misspelt retrieval recall@k | Of the expected slides of each variant's question, pooled over every variant, those in that variant's top k retrieved, `k` being 0005 (d)'s. | Tier 2 | Baseline |

  It is pooled per variant: two variants of one question each count that question's expected slides, so one variant's miss is not hidden by a sibling's hit. The report key is `misspeltRetrievalRecall`, beside `retrievalRecall`. It reads not-measurable when no question carries a variant. Like every baseline row, it is never red on its own (0005 (f), (j)).

- **(e) Tiers and recordings.**
  - Tier 2 retrieves each variant through `IndexRetriever.retrieve`, the app's own path.
  - Tier 1 replays that retrieval. A variant adds one embedder recording when its corrected text differs from every clean question's corrected text. It never adds a generator or verifier recording, and the per-question Ask latency is unchanged.
  - A variant committed without a fresh tier-2 run is a recording miss, which is red, as 0005 (e) requires.
- **(f) The report.** 0005 (f)'s floor gains this row. Per-variant failures are not in the report: the floor's per-item lists belong to its two absolute metrics. Which variant missed is read from the run itself.
- **(g) Restatement ledger**, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes. Owned here: the `misspelt` field, the definition of the row in (d), and its report key.
  - Sweep: three families, run at `bdab15e` on 2026-11-02 for branch `395-misspelt-variants`. Their commands and output are in #395's plan comment:
    - the golden-question field set;
    - the report's metric set;
    - the rule that every golden question is asked.
  - Carriers trued up in the change that lands this ADR: `eval/src/golden-question.ts`, `eval/src/audit.ts`, `eval/src/retrieval-recall.ts`, `eval/src/report.ts`, `eval/src/run-eval.ts`, `eval/README.md` and `docs/plan.md` §7.
  - Citers left standing, still true: 0005 (c), (d) and (f), and 0009 (o).
- **(h) What does not change.**
  - 0005 (b): the contradiction set.
  - 0005 (e)–(g): the two tiers and the gate.
  - The definition and baseline of retrieval recall@k.
  - `CourseIndex.search`, fusion, and the app's ask path.
  - There is still no undo control for a correction (#393).
- **(i) What #395 delivers:** the schema, the audit, the metric, the report key, the runner, the committed variants, the carriers in (g), and a live tier-2 run.

## Options considered

**A. Amend 0005 in place.** A dated `## Amendments` entry, with (c)'s field list and (d)'s table trued up inline. It would keep every eval field and row in one file. Rejected: `docs/adr/README.md` § Amendments limits amendments to moved or wrong values, and the precedent for new eval rows is a new ADR (0006 (h), 0009 (o)).

**B. Variants as golden-question lines of their own.** No new field would be needed. Rejected:

- each variant would be asked and verified, costing generator calls on every run;
- each would join 0009 (o)'s "every golden question" and the contradiction set;
- clean and misspelt questions would share one recall denominator, so neither figure could be read alone.

**C. A separate file, such as `eval/misspelt.jsonl`, keyed by question text.** Rejected: two files held together only by an audit, and a renamed question would orphan its variants.

**D. Pool per question.** A question would count once if any of its variants found the slide. Rejected: it hides a variant that misses behind a sibling that hits.

**E. A field on the question, retrieved only, pooled per variant (chosen).** Its downsides are genuine and accepted:

- every variant costs an embedder call at tier 2 and a recording at tier 1, and a new variant owes a run;
- the report carries no per-variant list;
- the vector list may still find a variant beyond the corrector's bound, so the row can read full even when the correction did nothing.

## Consequences

**Easier.** A change that weakens typo tolerance shows as a fall in a row beside the clean figure.

**Harder.** Each added variant owes a tier-2 run before tier 1 is green again.

**Explicitly accepted.** Variants are a sample, not one per question. Which variant missed is not in the report.

**What would make us revisit.** A sample large enough to split the row by edit kind; a grammar or dictionary pass joining the correction (`docs/tech-debt.md`, the 2026-10-21 entry on spelling correction); or a retrieval change under which a misspelt question needs its own expected slides.
