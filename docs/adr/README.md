# Architecture Decision Records

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

Numbered. Once **merged**, a decision is immutable: changed your mind → supersede, never rewrite. Two edits to a merged ADR are allowed, both narrow — its stated parameter values when the code later legitimately moves them, and its Status line when a later ADR supersedes it; see **Amendments** below. Before merge an ADR is still a draft under review: amending it in place in response to review feedback is correct, and cheaper than merging a decision you already know is wrong and superseding it immediately. Write one when a decision is expensive to reverse, cross-deployable, or would surprise a newcomer — see `docs/standards/architecture.md` rule 6.

Format: copy `0000-template.md` → `NNNN-short-title.md`, then add a row to the index below.

The index is not decorative: `pnpm verify` runs `.claude/scripts/check-adr-index.sh`, which fails
if a `NNNN-*.md` file here has no index row, or if a row links a file that does not exist under
that number. Rows must keep the `- [NNNN — Title](NNNN-slug.md)` shape the gate parses.

A row may carry one optional annotation after the link — an em dash with a space on each side,
then non-empty text — which is where the index records a supersession:

```
- [0042 — Example decision](0042-example-decision.md) — superseded by 0043
```

The superseded ADR's own Status line records it too (see **Amendments**), so a reader who opens
the old file directly learns it is no longer current.

The suffix is optional but not free-form: `— ` with nothing after it, or an annotation that
misses the separator, is a malformed row and fails the gate.

Two more things the gate checks, so that a decision's standing can be read mechanically:

- **Status.** Every `NNNN-*.md` except `0000-template.md` must carry exactly one `Status:` line
  in its header (above the first `##` section) whose value is exactly `proposed`, `accepted`, or
  `superseded by NNNN` — the vocabulary the template's Status line lists, lower-case. Markup
  around the label is up to you (`- **Status:** accepted` is what the template uses); the value
  is not. This bullet owns the vocabulary, and its carriers are listed in
  `.claude/ledgers/adr-status-vocabulary.ledger`. One parser reads the line,
  `.claude/scripts/adr-status-lib.sh`, for both this gate and the merge-time accept flip, so an
  ADR the gate passes is one the flip can read (#115).
- **Supersession pointers.** Any `superseded by NNNN`, whether in a Status line or an index
  annotation, must name an ADR file that exists here. The template's own `0000` does not count:
  it is a form, not a decision.

## Amendments

A merged ADR's decision and rationale never change — retconning a decision is what
supersession exists to prevent, and git preserves every prior version regardless. Its status
changes in one case only: when a later ADR supersedes it, the superseding ADR's PR sets the old
ADR's Status line to `superseded by NNNN` and adds the matching index annotation, and touches
nothing else in the old file (owner decision 2026-10-20, #114). But an ADR
also states facts — parameter values, sizes, counts — that code legitimately moves later, and
a stale number in an authoritative document misleads every reader who takes it as current;
planners here are _instructed_ to read ADRs before code, so wrong numbers propagate into plans
silently (decided in cumulo 2026-08-01, prompted by cumulo#122 moving a retry budget an ADR
stated).

When only a stated value has moved and the decision stands, an amendment has two halves, and one
of them is always written. **The dated entry is not optional**: append it to an `## Amendments`
section at the bottom of the ADR — old value → new value, the driving issue/PR, and the code
location that now owns the value. **What the inline half is depends on what the moved number is
doing in the document**, and the test is carrier versus premise:

- **A carrier** states the value and nothing else leans on it — a table cell, a parenthetical, a
  Consequence line. True it up inline where it appears; the entry records the move.
- **A premise** cannot move without moving the inference built on it: the option was chosen
  _because_ the number was what it was, so truing it up inline rewrites the document into a
  reasoning it never had — the retcon supersession exists to prevent. The entry alone records the
  move, and the reader is protected inline instead, by an **as-it-stood annotation** wherever the
  figure would otherwise read as current: quote the figure, mark the quotation ("quoted as
  NNNN stood when this was written"), state what it was amended to and when, and point at the
  owning ADR's `## Amendments`. Where an entry has already declared a whole family of in-body
  figures historical wholesale, **that declaration is the inline half**, and no per-figure
  annotation is owed on top of it.

The test applies figure by figure, not document by document. cumulo's worked premise-side case
was a sizing table in which both halves lived side by side: one row was trued up inline because
nothing leaned on it (cumulo#156), while a later move (cumulo#258) left another row standing,
because that row was what the decision had been sized against — trued up, the table would have
read as an option the ADR considered and rejected. Its entries are the record, and they state in
the entry what the row no longer describes. That is why such a table is not reconciled cell by
cell.

**A value that was wrong when written is amendable too**, not only one the code has moved under
the document: cumulo#200 re-based one ADR's cost frame that had been computed at the wrong
pricing basis, and made another ADR's absolute claim precise, each recorded as an entry. The
guardrail is unchanged, and it is what sorts the two cases: an amendment never touches
reasoning. If you find yourself rewording _why_, that is a supersession in disguise — write the
new ADR. A wrong number is amended; wrong reasoning is superseded.

**An amendment entry names the known quoters and citers of what it amends** — the sites elsewhere
in the repo that repeat the value or lean on it. That list is a **floor, not a census**: it is
what the amender's sweep found, so it states the sweep that found it, pattern and date, and a
later reader can tell an unsearched place from a searched one. It is the shape
`docs/standards/architecture.md` rule 9 asks for beside an owned value — the restatement ledger —
pointed the other way. What each kind of quoter is owed differs:

- **Mutable quoters** — code, comments, READMEs, standards prose — are trued up in the same
  change (rule 11: prose that argues for a value is part of that value's change surface).
- **Quoting ADRs** are immutable, so they are not trued up: patch the quotation with the
  as-it-stood annotation above, and give that ADR its own dated entry.
- **The backwards case** — an ADR quoting mutable code — freezes nothing. The code keeps the
  value and keeps moving; the code owner's rule-9 restatement ledger lists the quoting ADR as one
  of its carriers, and the true-up is dispatched from there.

Who finds the copies: the amender, working off the owner's ledger — and whoever later finds a
copy the ledger missed banks it there, so the next amendment starts from a longer floor.

**The sweep an amendment owes is rule 10's**, inherited whole; read it before editing rather than
trusting a grep for the old literal. The half that ADR-shaped amendments miss is the **derived**
one — a fraction of a ceiling, a "roughly half", a duration computed at a run rate, the scope
line of a basis caveat — which carries no copy of the number that moved. Rule 10 says how to
shape a sweep that reaches it.

## Index

- [0001 — Grounding architecture: retrieval + citation + verification, not fine-tuning](0001-grounding-architecture.md)
- [0002 — Deployables: one app plus a bundled model runtime; local-first; nothing public](0002-deployables.md)
- [0004 — Storage: one SQLite file per course; FTS5 + sqlite-vec; no shared store](0004-storage.md)
- [0005 — Evaluation as a merge gate: the synthetic deck, the contradiction set, two tiers, the metrics and their bars](0005-evaluation-as-gate.md)
- [0003 — Model roles and backends: four roles, each configured alone; encoders in-process, the generator in-process or over private HTTP; candidates measured, not pinned](0003-model-roles-and-backends.md)
- [0006 — Image-only slides: OCR and captions as derived text, flagged and shown with the original](0006-image-only-slides.md)
- [0007 — Desktop packaging: an Electron shell around the one server; an unsigned NSIS installer from CI; weights downloaded at first launch by digest; OCR data inside](0007-desktop-packaging.md)
- [0008 — Slide chunking: a slide is indexed as one or more chunks; citations stay on the slide](0008-slide-chunking.md)
