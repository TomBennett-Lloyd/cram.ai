# 0001 — Grounding architecture: retrieval + citation + verification, not fine-tuning

- **Status:** proposed
- **Date:** 2026-10-14
- **Issue:** #1

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into answers, revision notes and practice exams, and every one of those is text a model wrote.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. The two bullets it answers are the ones headed "Nothing the tutor says is uncited" and "The slides win"; the others bound where any answer to them may run.

The hard case is a class of subject, the one the README names: subjects where the slides deliberately differ from what a general-purpose model "knows". Naturopathic medicine is one example; a course that teaches a simplified model before the full one is another. In that class the base model's beliefs are not noise around the right answer but a confident, fluent alternative to it, and a model told in its prompt to ignore them still produces them — as a contradicting sentence, or as an unsolicited caveat. So those beliefs have to be excluded mechanically, at a step that does not depend on the model's cooperation, not by prompt.

The tutor runs where the slides are. Issue #3's target-machine comment describes a CPU-only laptop with a few GB free for models: nothing that needs training hardware is available, and every extra model call is time the student waits through.

Three positions were settled when the owner accepted `docs/plan.md` on 2026-10-13, and this ADR records them rather than reopening them: no per-user fine-tuning; the tutor frames everything as what the student's slides say, never as what is true; and the contradiction set in `eval/` is held to the contradiction-set bar `CLAUDE.md` § Hard constraints sets.

## Decision

`docs/standards/grounding.md` turns this decision into the rule every text-producing feature follows.

- **(a) No per-user fine-tuning.** A student's course never trains any weights. Course content reaches the model only through the prompt, at inference time.
- **(b) The unit is the only vehicle for model-produced text the student reads.** A unit is `{text, citations[], kind}`, and a citation is `{sourceId, quote}`: the id of a source and a verbatim span of that source's text. The schema is owned by `@cram/shared` once #8 lands; this ADR fixes the shape, not the field types. Three things a model produces reach the student without being units, and none may carry a claim about the subject: a label from a closed enum (a verifier or grading verdict), a topic tag (a noun phrase in the course index that the student can edit — metadata, never a statement), and a fixed system string that carries no model text. That list is closed; `docs/standards/grounding.md` rule 1 restates it as the rule.
- **(c) Every request runs one pipeline.**
  1. **Retrieve** candidate sources from the course index; nothing else enters the generator's prompt as a source of facts.
  2. **Generate** units from the retrieved sources only, each carrying its citations; an empty list is a valid output, and is how the tutor says the slides do not cover the request.
  3. **Resolve** every citation mechanically, with no model involved, by three checks: the source exists, it was in the retrieved set for this call, and its quote is a substring of the source's text after whitespace normalisation. A unit with a citation that fails any check never reaches the verifier.
  4. **Verify** each surviving unit against its quotes only, under the contract in (d).
  5. **Report** what was withheld at either stage, so the student sees the system dropping text and can report a false negative.
- **(d) The verifier contract.** The input is one unit's text plus the quoted spans of its citations, and nothing else: not the question, not the rest of the cited slides, not the other retrieved sources. Narrowing the input is what makes the verdict mean something — a verifier shown the question or the whole slide can credit a statement to context the student never sees cited. A unit may cite any number of sources, and the verifier judges the statement against the union of its quotes. The output is exactly one of `supported | partial | unsupported`. `unsupported` is always withheld. `partial` is handled per feature from a closed policy set: `drop` withholds the unit; `rewrite-once` asks the generator to rewrite it against its quotes once, the rewrite is re-verified like any unit, and a second `partial` is dropped. The feature's module names its choice. How the verdict is computed — an LLM prompt or an NLI model — is ADR 0003's (#3); any implementation meets this contract.

  Restatement ledger, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes: the verdict vocabulary and the policy set are owned here. Sweep: `git grep -nE 'supported \| partial|rewrite-once' -- ':/'`, run at `bb8a720` on 2026-10-14 for branch `1-adr-0001-grounding`; its one hit there, `docs/plan.md` §3.4, is replaced by a pointer to this ADR in the same change, which also lands the known carriers: `docs/standards/grounding.md` rule 4 (the verdicts and the policy set) and rule 7 (the withheld reasons, which quote two of the verdicts).

- **(e) "Your slides say" framing.** No prompt — generation, rewrite or verification — describes the subject as true or false; a prompt describes only what a cited source says. The tutor reports the course and does not vouch for it, and a prompt that asked the model to judge truth would invite the very beliefs (c) and (d) exclude.
- **(f) The contradiction set in `eval/` is this decision's regression test.** Its bar is owned by `CLAUDE.md` § Hard constraints; how it gates a merge is ADR 0005's (#5).
- **(g) A single shared _style_ LoRA, trained on synthetic data, remains a possible future.** It would teach how an exam board's questions sound, not what is true, and would be one adapter for every user. It needs its own ADR, and measured need first.
- **(h) Statements synthesise; quotes anchor.** A unit's text may summarise across any number of slides and lectures and is never required to be slide wording: the information a student needs is distributed across a course, and compiling it is the product. What grounds a unit is its anchors, not its wording — every claim in it must be entailed by the quotes it carries, which (c) checks are really in the source and (d) checks really support it.
- **(i) Sources generalise slides.** The cited thing is a _source_, and `slide` is the only kind this ADR admits. The student's own notes are a foreseen second kind; admitting them needs its own ADR (#21), for their trust tier relative to the slides and for how a note that contradicts the slides is caught.

## Options considered

**1. Per-user fine-tuning.** What it would buy is real: no retrieval step, no verifier latency, and a tutor that sounds like the course. What it cannot buy is the comparison below, drafted in `docs/plan.md` §1, trued to #3 and #5 on the way in, and owned here from this ADR on.

| Goal                                       | Fine-tuning per user                                                                        | Retrieval + citation + verification                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Answer only from the slides                | No mechanism. Weights blend slide text with pre-training; nothing marks the boundary.       | Structural: the generator only sees retrieved slides; unsupported text is cut. |
| Slides override base knowledge             | Unreliable. Small LoRA runs barely move strongly held priors; large runs destroy the model. | Mechanical: a claim with no supporting slide fails verification.               |
| Show the student where an answer came from | Impossible — weights have no provenance.                                                    | Every unit carries quote-anchored citations and the UI shows the slide.        |
| Update when a lecture is added or fixed    | Retrain.                                                                                    | Re-index one file.                                                             |
| Run on a laptop                            | Training needs a GPU with tens of GB; hours per user.                                       | Inference only; a small quantised model fits the target laptop (sizing: #3).   |
| Test it                                    | Hard to measure what was learned.                                                           | A golden question set with known slide answers is a merge gate (#5).           |

Rejected: it fails the subject class in Context at exactly the point that matters, because fine-tuning moves how a model sounds far more than what it believes.

**2. Prompt-only grounding, no verifier.** Retrieve, instruct the generator to stay inside the supplied slides and cite them, and show what it writes. It is the cheapest option — one model call per request, nothing added to latency on the target machine — and on an ordinary subject it is mostly right. Rejected because "mostly" is the whole problem in the class Context names: "the slides win" stays a prompt hope, a citation is a claim the model makes about itself with nothing checking it, and the unsolicited "mainstream medicine says…" caveat survives, because nothing removes a sentence the model was only asked not to write.

**3. Retrieval + quote-anchored citation + verification (chosen).** Its downsides are genuine and accepted:

- Every unit costs a verifier call on a CPU-only machine, so an interactive answer waits for generation and verification both.
- False negatives withhold true answers: a verifier stricter than the quotes warrant hides correct, cited statements, and the student is shown less than the slides support.
- A synthesised statement whose quotes are each true can still mislead by juxtaposition — two accurate quotes joined by a connective neither of them states. The verifier, judging the statement against the union of its quotes, is the only guard, and it is the model-dependent step.
- Recall is bounded by retrieval: a slide that is not retrieved cannot be cited, so an answer the slides do support can come back as not covered.
- OCR-derived text weakens quotes: a quote from text recognised in an image passes the substring check against whatever the recognition produced, right or wrong. How derived text is flagged and shown is ADR 0006's (#6).

**4. Choosing the verifier's implementation here** — an LLM prompt or an NLI cross-encoder. Deliberately deferred to ADR 0003 (#3), which measures both on the target machine. This ADR fixes only the contract in (d), so that choice can move without reopening this one.

## Consequences

**Easier.** The base model's beliefs are excluded mechanically: a sentence only the base model believes has no quote that supports it, and is withheld before the student sees it. Every unit carries the source and span it rests on, so the UI can show provenance rather than assert it. A lecture added or corrected is re-indexed, not retrained. Resolution and the verifier contract sit in a pure core over a model-gateway interface (`docs/standards/architecture.md` rule 3), so every guarantee in (c) and (d) is testable against a fake gateway with no model running.

**Harder.** Latency, on every request that has a student waiting. The withheld report is its own design problem: it must show what was dropped without the dropped text reading as something the slides say. And no student-visible text path is exempt — every feature pays the verifier, so no feature is as cheap as its generation step alone.

**Explicitly accepted.** The draft plan expected exams to `drop` and notes to `rewrite-once`; that is a starting expectation each feature's ticket decides, not a decision made here. This ADR fixes the policy set, not any feature's choice from it, and Ask's choice is #13's.

**What would make us revisit.** A verifier whose false-negative rate cannot hold the contradiction set at its bar without withholding most true answers — the mechanism would then be trading the student's trust in true statements for safety against false ones. Or measured need for the style LoRA in (g).
