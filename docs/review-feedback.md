# Review-feedback log

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13 (header only; cumulo's entries were not carried over)._

Every substantive piece of human review feedback — on plans or PRs — gets an entry here. On a `humanAlways` PR the entry does not wait for the owner to speak: it **begins on the branch before review**, stating what the PR asks the owner to decide, and **completes at merge**, when whoever merges fills in both the category and the verdict (see `## Entry format`). Feedback that arrives outside a PR is still logged as it is addressed. `/retro` mines this log to update standards and agent guidance, and the graduation rule below reads its categories, so the vocabulary has to mean something: it is declared here, closed, and trued up to what the entries actually say.

## Entry format

```
## YYYY-MM-DD — [PR/issue #n — ]<short-slug>

- **Category**: one category from the vocabulary below
- **Feedback**: what the user asked for, verbatim where short
- **Why**: why the feedback is right — the reasoning or evidence behind it, not a restatement of it
- **How applied**: what changed in response (code fix, standards edit, agent-guidance edit, config flip, or none + why)
- **Verdict**: filled at merge by whoever merges — what the owner decided, verbatim where short, and the outcome
```

One entry per distinct feedback item; the slug names that item's subject and disambiguates multiple items arising from the same review. The `PR/issue #n` segment is present when the feedback attaches to one PR or issue, and omitted when it arrived in chat outside any single one — name the PRs in the body instead.

**The pre-label state.** An entry written on a `humanAlways` branch before review — the state `merge.mergeRitual` in `.claude/workflow.json` requires, since the entry has to be part of the diff the owner approves — fills **Feedback** with _what the PR asks the owner to decide: the ask, never a prediction of the answer_, and writes both **Category** and **Verdict** as the literal placeholder `pending — filled at merge`. Whoever merges fills both **on the branch, before the label comes off**, in the commit that responds to the approval; a clean approval gets a one-line verdict commit and nothing more. A merged entry still reading `pending` is a verdict nobody filled, and it reads as exactly that — which is why the placeholder is literal and identical everywhere, and why an entry that guessed the category and the verdict instead would be indistinguishable from a record of what was actually decided. That distinguishability is the whole point of the form.

**Restatement ledger for the placeholder literal** (`docs/standards/architecture.md` rule 9). The sentence above owns the string `pending — filled at merge`; "literal and identical everywhere" is the property, so the sites that quote it have to move with it. **A change to the string re-runs the sweep** — `git grep -nF 'pending — filled at merge' -- ':/'`, plus an arm shaped around the claim, since a paraphrase ("the placeholder", "left pending") is invisible to a literal sweep. This list names the carriers that sweep found in cumulo and that were carried over with the ported tooling; it promises nothing about being all of them, and an enumeration that promised that would be falsified by the next quoting site.

- **Carriers — they state the literal and must move with it**: in this file, the `## Entry format` sentence above, which owns it, and the `## Category vocabulary` section, which quotes it while declaring that the string is not a category. Outside it: `.claude/skills/review-loop/SKILL.md` step 5, which tells the writer what to put in the two fields; `.claude/skills/run-issue/SKILL.md`'s ticket-agent lane, in the sentence pointing at `merge-pr.sh`; and — the only **executable** carrier — `.claude/scripts/merge-pr.sh`'s feedback step, with `.claude/scripts/merge-pr.test.sh` carrying it in the fixtures on both sides of that step's refusal.
- **Why the executable carrier is the one that matters.** Its failure direction if the string moves without it is a **quiet pass**, not a refusal: the step matches the field names `- **Category**:` and `- **Verdict**:` — different strings, which go on matching — and only the placeholder test stops matching, so the gate opens and a `humanAlways` PR merges with no verdict. Contrast the path `docs/review-feedback.md`, whose ledger lives in `.claude/workflow.json` → `feedbackLogLedger` and whose carriers fail loud and closed. A gate that fails open is the reason this ledger exists at all.
- **Not carriers**: past-tense narration of what a specific entry or PR did; pointers that name the placeholder without quoting it; and a live `- **Category**:` or `- **Verdict**:` field still reading the placeholder **on an unmerged branch**, which is the form being used rather than declared. On a merged entry the same field is not a use of the form but a verdict nobody filled, which is what the sentence above and the vocabulary below both say.

## Category vocabulary

Closed list — every entry's category is one of these:

- **plan** — the shape of a plan before it is executed: scope, chunking, sequencing, acceptance criteria, what a ticket defers.
- **code-style** — how code is written within an already-agreed structure: naming, function and module shape, hooks and scripts, formatting gates.
- **architecture** — decisions that ossify: interfaces, data models, infrastructure topology, ADR content.
- **testing** — what is tested, how, and what counts as evidence. No entries yet; kept declared so test feedback has a home, and see the graduation rule for why an empty category is not a quiet one.
- **convention** — a documentation or process convention the repo follows, distinct from the code it describes (e.g. how ADRs are amended).
- **gate-calibration** — where an approval gate sits: which changes need the human, which run autonomously, recorded when the gate itself moves.
- **approved-no-changes** — the owner approved a human-gated change with no revisions requested. Logged because a quiet category has to be distinguishable from an unlogged one. It is assigned at verdict time by whoever merges, never predicted before the label comes off: a pre-label entry writes `pending — filled at merge` and waits for the approval it would otherwise be guessing at.
- **other** — feedback that genuinely fits none of the above. Reach for it last.

A parenthesised qualifier after the category — `other (verification rigour)`, `issue #n (plan review)` — is a permitted annotation, not a category. Only the bare word before the parenthesis counts as the category. A feedback item that needs a category not listed here adds one to this list in the same PR as the entry — that is what keeps the list both closed and honest. `pending — filled at merge` is a declared placeholder and not a category: it is valid only on an unmerged branch, where it says the owner has not decided yet and so no category can honestly be chosen. It is deliberately absent from the list above, because a category on that list is selectable and this one must never be.

## Graduation rule

A category going quiet across consecutive reviews is the evidence for graduating that gate toward autonomy (a flag flip in `.claude/workflow.json`, proposed as its own PR, decided by the user). In terms of the vocabulary above:

- Quiet means no change-requesting entry in that category. **approved-no-changes** entries are positive evidence of quiet, not entries against the subject category.
- **gate-calibration** entries record a gate that has already moved. They are the rule's output, not its input, and never count as evidence for the next move.
- A category with no entries at all has never been exercised. That is absence of evidence, not evidence of quiet, and cannot on its own graduate a gate.

---

## 2026-10-14 — issue #1 — plan-feedback-quote-anchored-synthesis

- **Category**: plan
- **Feedback**: "we need it to be a bit less verbatim than exact quotes from the slides, every statement needs to be backed up by exact quotes from slides but the statements themselves should be able to summarise across all the available information"
- **Why**: the information a student needs is distributed across a course, so a tutor limited to slide wording cannot compile it; anchoring every claim to substring-checked quotes keeps synthesis exactly as mechanical to verify as extraction was.
- **How applied**: `docs/adr/0001-grounding-architecture.md` § Decision (b), (c), (d) and (h); `docs/standards/grounding.md` rules 1, 3, 4 and 9; `docs/plan.md` §3.5.
- **Verdict**: owner-directed in chat 2026-10-14, applied before execution

## 2026-10-14 — issue #1 — plan-feedback-notes-as-future-source

- **Category**: plan
- **Feedback**: (paraphrase) the student's own notes may in future join the slides as a source, and must not contradict the lectures unless that is intentional.
- **Why**: admitting a second source kind changes trust and precedence, which is an ADR-sized decision, so the ADR names the kind without admitting it.
- **How applied**: `docs/adr/0001-grounding-architecture.md` § Decision (i); `docs/standards/grounding.md` rule 9; #21 opened (parked).
- **Verdict**: owner-directed in chat 2026-10-14, applied before execution

## 2026-10-14 — issue #1 — plan-feedback-subject-class-not-one-subject

- **Category**: plan
- **Feedback**: "naturopathic medicine is just an example not the only use case"
- **Why**: the mechanism is for the class of subject whose slides deliberately differ from what a general model knows, and naming one subject as the use case would misdescribe the product in an immutable record.
- **How applied**: `docs/adr/0001-grounding-architecture.md` § Context states the class, with naturopathic medicine as one example.
- **Verdict**: owner-directed in chat 2026-10-14, applied before execution

## 2026-10-14 — issue #1 — adr-0001-grounding-architecture

- **Category**: approved-no-changes
- **Feedback**: the PR asks the owner to decide:
  - accept `docs/adr/0001-grounding-architecture.md` § Decision (a)–(i), in particular the quote-anchored citation shape, the verifier contract in (d) with its implementation deferred to ADR 0003, and that contract's closed policy set for `partial`;
  - accept `docs/standards/grounding.md` rules 1–9, in particular rule 3's substring test and rule 9's synthesis rule;
  - accept the `docs/plan.md` §1, §3.4 and §3.5 pointer replacements, and the `README.md` pointer to `docs/standards/grounding.md` rule 4;
  - accept the one-line `CLAUDE.md` re-point.
- **Why**: `docs/adr/**` and `CLAUDE.md` are `humanAlways` paths and the issue carries `adr`, so the owner decides, not the review loop.
- **How applied**: the PR as proposed — ADR 0001 at `proposed`, the standard, and the pointers; revised in place on the branch if review asks.
- **Verdict**: approved in chat 2026-10-15 — "okay i think that PR looks good" — with no revisions requested; ADR 0001 flipped to `accepted` in the verdict commit and the PR merged.

## 2026-10-15 — issue #2 — adr-0002-deployables

- **Category**: approved-no-changes
- **Feedback**: the PR asks the owner to decide:
  - accept `docs/adr/0002-deployables.md` § Decision (a)–(g), in particular the one-deployable count reconciled against the three `apps/*` directories in (a), the model runtime outside the count in (c), the per-mode loopback binding in (d), M6 as a configuration of the same deployable in (e), #26's placement in (f), and the evidence-backed bar for a second deployable in (g);
  - accept the `docs/plan.md` §3 lead-paragraph pointer and the §7 item 2 true-up;
  - accept the `docs/standards/architecture.md` rule 4 path cite;
  - accept the `docs/adr/README.md` example-row re-numbering.
- **Why**: `docs/adr/**` is a `humanAlways` path and the issue carries `adr`, so the owner decides, not the review loop.
- **How applied**: the PR as proposed — ADR 0002 at `proposed` and the pointers; revised in place on the branch if review asks.
- **Verdict**: approved in chat 2026-10-16 — "PR 41 sounds good" — no revisions requested; ADR 0002 flipped to `accepted` in this commit and the PR merged as proposed.
