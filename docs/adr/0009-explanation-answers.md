# 0009 — Explanation answers: the tutor explains the course in its own words, quotes are marked pointers, and verification depth is chosen by surface

- **Status:** accepted
- **Date:** 2026-11-02
- **Issue:** #366

## Context

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. It answers the two bullets headed "Nothing the tutor says is uncited" and "The slides win", and it changes how each one is enforced, surface by surface.

The owner used the app on their own deck and found that it found the right slides but did not explain them. It returned slide text verbatim, and it withheld any answer that reported only part of a bullet (#367). The owner's direction, 2026-10-21: the tutor "should be allowed to explain the contents of the lecture", and "the assumption is that the text is generated unless we say that it's a direct quote from a slide". Over a REVISE and four addenda on #366, the owner framed the contract as the way a coding agent works in a codebase:

- **The slides are the repository.** The explanation is the tutor's own words about _this_ course, never about the subject in general.
- **A direct quote is a pointer to a line, marked as one.** Unmarked text is the tutor's words, and marked text is the slide's.
- **General knowledge interprets what the slides say** — what a term means, how two slides connect — the way an agent knows what a language construct means. It never adds a fact about the course that the slides do not state.
- **Every claim about what the course says should be findable in the retrieved slides**, as every claim about code is findable in the files.
- **"Your slides don't cover this" is "that is not in this codebase".**
- **The context is the file in question plus the module it sits in:** the retrieved slides raw, plus a stored summary of each of their lectures, so that no slide is read out of its lecture's context. The stored summaries are the course map.

Two of the owner's later answers correct what the earlier design assumed:

- **The verifier must tell "the slides say X" from "X is what that term means".** Answer of 2026-10-27, verbatim: "i think we should re-design the verifier if it can't tell "the slides say X" from "X is what that term means" … contradiction has to be based on meaning not text matching … for exams and preparing a revision guide we want to do a deeper verification … but for chat type interactions we can just do a search for potentially relevant slides rather than doing a full verification". One check for every surface is wrong.
- **Chat cuts nothing.** Answer of 2026-11-02, verbatim: "for chat, i don't want it to cut any part of the answer, it just needs to show which slides might contain relevant information so that the user can do their own verification if needed". Amended the same day: "make text that appears to contradict the slides highlighted in red with some kinda link to the slide it contradicts so the user can check but we don't remove it".

The owner's verbatim words, in full and with dates, are in #366's plan comment, and the questions the owner accepted there are Q1–Q13.

Those answers reverse parts of `docs/adr/0001-grounding-architecture.md`. Its (b) makes the unit the only vehicle for model-produced text. Its (c).4 and (d) verify each unit against its quotes only. Its (h) requires every claim to be entailed by the quotes it carries. Its § Consequences says that "no student-visible text path is exempt — every feature pays the verifier". Reversed reasoning is superseded, not amended (`docs/adr/README.md` § Amendments), so **this ADR supersedes 0001**. It keeps 0001's (a), the order in (c), (e), (f), (g), (i) and the fine-tuning comparison in § Options 1 by reference, and it replaces (b), (c).1–4, (d), (h) and that § Consequences sentence. The immutable ADRs that cite 0001 — 0003, 0005, 0006 and 0008 — cite it by section. Each of those citations reads, from this ADR on, as a citation of the point here that keeps or replaces that section.

## Decision

- **(a) Three shapes, each defined once in `@cram/shared`, and the closed list of what else the student reads.**
  - An _explanation_ is `{text, quotes[], sentences[], sources[]}` (`Explanation`, in a new `packages/shared/src/explanation.ts`):
    - `text` is the explanation as shown.
    - `quotes` are the marked slide lines, each `{sourceId, quote}` resolved from a pointer ((c)).
    - `sentences` holds one `AttributedSentence = {text, slides, contradicts}` per sentence of `text`. At the light depth, `slides` are the candidates a search found ((f)); at the deep depth, the slides whose text entailed the sentence ((d)). `contradicts` lists the slides the checker scores as contradicting the sentence, best-scoring first, and is empty when none does ((g)). It is always empty in shown deep output, where a contradicted sentence is cut and the withheld entry names its slide ((h)).
    - `sources` is every slide named in `quotes` or `sentences`, numbered in first-use order, at least one.
    - `ExplanationSurface = 'ask' | 'revision-guide'` sits beside it.
  - A _reported unit_ is today's `Unit`, for exam questions, gold answers, rubric points and lecture-summary lines. `UnitKind` gains `lecture-summary` and loses `answer-sentence` and `note-bullet`.
  - A _lecture summary_ is `{lectureId, units}`, its units reported units.
  - Beyond those three shapes, model output reaches the student as 0001 (b)'s two non-claims (a label from a closed enum, a topic tag) and nothing else, and the fixed system strings are not model output. That list is closed.
  - `AskReply`'s grounded arm carries `{explanation, withheld, slides, leftOut, searched?}`; `slides` records every slide the reply names (the retrieved set, the candidates and the contradicting slides). The not-covered arm keeps `{withheld, slides, searched?}` and gains `leftOut`.
- **(b) The pipeline order holds — retrieve → generate → resolve → verify → report — and generation begins with assembly.**
  - `assembleContext` (pure, `packages/grounding/src/assemble-context.ts`) takes the retrieved slides best-first, the stored summaries of their lectures ((l)) and the prompt budget ((j)). It returns `{raw, summaries, leftOut}`. The prompt puts its fixed text first, then the raw slides, then the summaries.
  - One generator call returns `{answer: {text, quotes} | null}`, where `null` means the slides do not cover the question.
  - The prompt is written in (e)'s register: one explanation of what the sources say, drawn from all of them together, in the model's own words. The model may use its own knowledge to interpret the slides, never to add a fact about the course, and a quote is a pointer to a numbered line.
  - **Nothing but the raw slides and the loaded summaries enters the prompt as a source of facts.** That widens 0001 (c).1 by exactly the summaries.
  - At the light depth the verify stage is attribution and the mark ((f), (g)).
- **(c) Resolution is mechanical, a quote is a pointer, and the model never writes one.**
  - A quote is a `LineCitation` (`{sourceId, line}`, #367), looked up in `slideLines` of a slide in `raw` — never a summary line. The looked-up line must occur in `text`, whitespace-normalised.
  - A pointer that fails either check is dropped as `dangling-citation`, with the line as its text. No sentence loses words for a bad pointer, at either depth.
  - **What is text matching and what is not.**
    - The verdict has never been text matching. `verify.ts` sends each (premise, hypothesis) pair to the pinned NLI cross-encoder (`packages/gateway/src/provisional-pins.ts`), which returns three-class scores. `nliVerdict` in `packages/grounding/src/nli-verdict.ts` labels a claim against `PROVISIONAL_NLI_THRESHOLDS` — a judgement by meaning, as is the LLM arm in `packages/grounding/src/prompts/verifier-prompt.ts`.
    - Before #367, the pipeline held exactly one string match: resolution required the model's _copied_ quote to be a whitespace-normalised substring of the slide's text. That is the check that rejected the owner's half-bullet.
    - Since #367 the model emits a line number and resolution looks the line up (`resolveCitations`). `quotesResolve` then checks a looked-up line against its own slide — an invariant, never a match of model text.
    - **So nothing the model writes is string-matched anywhere in the pipeline, and chat's checker ((g)) is the same cross-encoder, judging by meaning.**
    - Two text matches remain, both by design. Retrieval's keyword half matches words ((n)). The eval's `mustNotContain` is a substring floor beneath the judgement by meaning (`docs/adr/0005-evaluation-as-gate.md` § Decision (c)).
- **(d) The explanation verdict at the deep depth: claims about the course must be findable, and interpretations must not be contradicted.**
  - Sentences are `splitClaims`'s. The premises are every raw slide's text and every loaded summary unit's text, each attributed to its slide or slides.
  - **Stage 1, the cross-encoder**, scores every (sentence, premise) pair and labels each sentence with `nli-verdict.ts`'s class:
    - **contradicted** if some premise scores contradiction at or above `contradictedAt`;
    - otherwise **entailed** if some premise scores entailment at or above `entailedAt`;
    - _(The order of these two bullets is quoted as it stood when this was written. Since 2026-11-02, entailed is read first, and a sentence any premise entails is never contradicted; see § Amendments.)_
    - otherwise **neutral**.
  - A contradicted sentence is withheld as `contradicted`, naming the first such premise's slide. An entailed sentence is kept, and its `slides` are those premises' slides.
  - **Stage 2** ((e)) classifies only the neutral sentences, each as a **course claim** or an **interpretation**. A neutral course claim is withheld as `unsupported`; a neutral interpretation is kept.
  - **The explanation is shown if at least one kept sentence is entailed.** Otherwise it is withheld whole as `ungrounded`, and the reply is not-covered. There is no `partial`.
  - An over-length pair goes to `docs/adr/0003-model-roles-and-backends.md` § Decision (d)'s second opinion. With no second opinion configured, it counts as contradicted (fail closed).
  - So every claim about the course is findable, interpretation is bounded by non-contradiction, and the model never labels its own output in the call that wrote it.
  - **These cuts exist at the deep depth only.**
- **(e) The sentence-kind pass: the generator under a judge prompt, over the neutral sentences only, after the cross-encoder.**
  - A separate generator call under `prompts/sentence-kind-prompt.ts` takes the neutral sentences, numbered, and the premises. It returns one kind per sentence as constrained JSON. That is the shape 0003 (a) already uses for the verifier's LLM arm.
  - The prompt follows `docs/standards/grounding.md` rule 6: it asks what kind of sentence each is, never whether it is true.
  - The pass is skipped when no sentence is neutral, and never runs at the light depth.
  - It fails closed. A `model-failed` or invalid reply, or a reply whose length differs from the input's, classifies every neutral sentence as a course claim.
  - The rejected shapes are in § Options C.
- **(f) Two verification depths, chosen by surface; the depth is an owned value; the light depth cuts nothing.**
  - `VerificationDepth = 'deep' | 'light'` sits in `packages/shared/src/verification.ts`. The per-surface choice, `VERIFICATION_DEPTH`, is owned by `packages/grounding/src/verification-depth.ts`, and its restatement ledger is declared with the code that adds it. Until then, this point is the rule.
  - **Deep — exam questions, gold answers, rubric points and lecture-summary lines, under the reported contract (every unit's claims entailed by its cited lines, policy `drop`), and revision guides, under (d).** The contradiction set is held at its bar here.
  - **Light — chat (Ask).** The pipeline is retrieval → assembly ((b)) → one generator call → pointer resolution ((c)) → **attribution** → **the contradiction mark** ((g)) → report.
  - **Attribution.** For each sentence of `text`, one course-wide `CourseIndex.search` over the sentence — BM25 over its words and a vector search over its embedding, fused by reciprocal rank. The top `ATTRIBUTION_K` slides, plus the slide any quote in the sentence points at, are the sentence's `slides`.
    - `ATTRIBUTION_K` is a new owned constant beside `RETRIEVAL_K` in `packages/index/src/course-index.ts`; this ADR sets no number for it.
    - The search is injected into `@cram/grounding` as a function, because that package depends on `@cram/gateway` and `@cram/shared` only.
  - **There is no entailment floor and no contradiction cut: every sentence the model wrote is shown.** A dropped pointer loses only its quote mark, and a contradicted sentence gains a mark and keeps its words.
  - At the light depth, not-covered is the model's `null` or an empty retrieved set — nothing else.
  - **Attribution is per sentence, not per answer**, for three reasons. The owner's example is one sentence resolving to one slide. A student checking one claim needs that claim's slides, not the whole answer's. And a per-sentence search can name a slide the question's retrieval never fetched. The per-answer list stays as `AskReply.slides`.
  - **The student's protection in chat is:**
    - the contradiction mark and its link;
    - the attribution beside each sentence and the sources list beneath the answer;
    - the slide panel that each reference opens;
    - the marked quotes, as exact pointers that resolution checks;
    - the prompt's framing under (e) of 0001, kept — the answer is explanation, never authority, and facts come only from the sources;
    - the reported light-depth rows in (o).
  - In chat, removing what the slides contradict is the student's decision, taken after seeing the mark.
- **(g) Computation reuses 0003's roles, and in chat the cross-encoder marks and never cuts.**
  - The cross-encoder reads three-class scores per pair at both depths. The LLM second opinion judges an over-length pair at the deep depth only, and the sentence-kind judge is a third use of the generator role, also deep only.
  - **The light pass** (`packages/grounding/src/mark-contradictions.ts`, pure over an injected `entail`) runs after attribution. It makes one batched `verifier.entail` call over each sentence paired with each of its own `slides`, with a whole slide's text as the premise.
    - A sentence's `contradicts` is the slides whose pair scores contradiction at or above `contradictedAt` — the deep Stage 1's class exactly — best-scoring first. _(Quoted as it stood when this was written. Since 2026-11-02, `contradicts` is empty when any of the sentence's slides entails it; see § Amendments.)_
    - An over-length pair gives no mark from that slide. Chat gets no second opinion, because that would be a generator call on the interactive path; the eval report counts such pairs.
  - **Why only the sentence's own slides.** Cost is pairs × time per pair, and `OnnxVerifier.entail` runs pairs one by one. The committed eval reports put a verifier call at ~30 ms on the dev class, so a ten-sentence answer at a small `ATTRIBUTION_K` costs about a second. Adding the whole retrieved set to every sentence would cost about three times that before summaries join.
    - The owner's example needs the candidates and nothing else: the contradicting slide is found by the sentence's own search, possibly outside the retrieved set, and a candidate is exactly what gets scored.
    - What the narrow pair set misses is measured against the wide one in (o).
  - **The display effect is a mark and a link, and nothing else** ((i)).
  - **Failure policy.** `entail` throws only on a broken model, and a verifier that fails to load stops the server at composition. No request-time "unavailable" class exists. So the pass has the deep arm's policy: a throw propagates to the request boundary (`docs/standards/error-handling.md`), and no system string is added for it. A backend whose failure is a value is a gateway change under 0003 (b), and that change brings its own note.
  - **The mark is 0001 (b)'s first non-claim** — a verifier verdict label from a closed enum, shown as a fixed string — so (a)'s closed list is unchanged.
  - 0003 (d)'s union-of-quotes premise and its `partial` second opinion describe the reported tier only.
- **(h) Withheld is reported at sentence granularity, and at the light depth only a pointer is ever withheld.**
  - `WithheldReason` gains `contradicted` and `ungrounded`.
  - `WithheldSentence` is one of `{reason: 'contradicted', text, sourceId}`, `{reason: 'unsupported', text}`, `{reason: 'ungrounded', text}` and `{reason: 'dangling-citation', text, sourceId}`. The first three are deep only. Chat's withheld panel holds dropped pointers alone, each with its slide and line.
  - Withholding at the deep depth is per sentence. The contradicted sentence is cut and the rest stands.
- **(i) The mark, the per-sentence references and the sources list.**
  - Nothing in `text` marks a quote. The renderer locates each `quotes[i].quote` in `text` and renders it as a quotation followed by its source number.
  - After each sentence, its `slides` appear as source numbers under a per-depth label: `MAY_BE_RELEVANT` at the light depth.
  - Prose carries no number (`docs/standards/design.md` rule 2).
  - **The contradiction mark — a design decision under `docs/standards/design.md` rules 2 and 9.**
    - A sentence with a non-empty `contradicts` is rendered in a `.contradicted` span. Its always-visible mark is a `--color-danger` underline, wavy, at `--line-sm`, in regular weight. Style, weight and hue tell it apart from the quote mark (solid `--color-accent`, heavier, semibold) in both themes.
    - The owner's "red" is the danger token — a meaning, never a value.
    - Its reference cluster holds the contradicting slides' numbers, each a button that opens the slide panel (`apps/web/src/ask/SlideDialog.tsx`) on that slide.
    - The words "appears to contradict" (`APPEARS_TO_CONTRADICT`) are **not permanent**: they appear on hover over the marked sentence and on keyboard focus of its contradiction button. That follows the owner's PROCEED of 2026-11-02: "can the appears to contradict be on hover not permanent".
    - The mark never relies on colour alone. Sighted readers get the wavy style. Assistive technology gets an accessible name on each contradiction button: the label, the lecture title and the slide number (`contradictionRefLabel`). That is design.md rule 2's move — a label for assistive technology becomes an accessible name — and the button is the span's one focusable element.
  - `sources` is numbered 1..n in first-use order, sentence by sentence. Each entry shows the lecture title, slide number, title, the derived label `docs/adr/0006-image-only-slides.md` § Decision (f) requires, and a thumbnail once #201 lands, and it opens the slide panel.
  - Beneath a chat answer, the fixed string `ATTRIBUTED_NOTE` says that the answer is written from the slides, that each sentence is checked only for contradiction, and that the listed slides are where to look.
- **(j) One prompt budget, owned once, in tokens the pipeline estimates.**
  - `PROMPT_TOKEN_BUDGET` lives in `packages/grounding/src/prompt-budget.ts`, declared in its own restatement ledger. It is the generator's context length (`PROVISIONAL_GENERATOR_CONTEXT_LENGTH`) minus `REPLY_TOKEN_RESERVE`.
  - This ADR sets no number; the code that adds the budget sets both values by measurement.
  - The assembler estimates tokens as characters ÷ `PROMPT_CHARS_PER_TOKEN`, tuned against the gateway's reported prompt tokens, and errs long.
- **(k) What gives way on overflow, and how the student is told.**
  - Summaries go first: the lowest-ranked lecture's first, each dropped whole. Then raw slides go, from the bottom of the ranking, never below one.
  - Every dropped slide, and every ranked slide whose summary was dropped, is listed in `leftOut`.
  - The student reads the left-out note, a fixed system string beside not-covered's (`LEFT_OUT`).
- **(l) The lecture digest — the course map.**
  - After each lecture's slides are chunked and embedded (`docs/adr/0008-slide-chunking.md` § Decision (c)), `summariseLecture` (`packages/grounding/src/summarise-lecture.ts`) makes one generator call per lecture. The call uses the reported prompt arm and returns at most `SUMMARY_MAX_UNITS` units.
  - Each unit is resolved and verified under the reported contract (`drop`), and the stored summary is the surviving units in order. The summary is reported, not explained, because a summary line enters the prompt as a fact.
  - A lecture over the budget is summarised in parts.
  - Summaries are stored in a `lecture_summaries` table in the course file (`docs/adr/0004-storage.md` § Decision (b)), and the file's version counter moves (§ Decision (d)). A summary is re-made when its lecture is re-uploaded, and when the course is rebuilt.
  - **Failure is a missing summary, never a partial one.** The decks screen reports it with a re-make action. Ask then loads that lecture's slides raw.
  - The student can read each summary directly on the decks screen, each line opening its slide.
- **(m) The scale case: sixty lectures, with relevant material on about twenty slides across about ten of them, for a question and for a study guide.**
  - The prompt is the fixed text plus twenty raw slides plus ten summaries. At assumed sizes per slide and per summary — measured by the code that adds the budget — that is a few thousand tokens. It fits a budget derived from the developer generator's context length, so every summary fits beside the twenty slides.
  - A shorter window overflows the summaries first ((k)).
  - **The decision to host a bigger model waits for a non-zero `contextOverflow` on a real course**, by the owner's deferral of 2026-10-21.
  - `RETRIEVAL_K` bounds recall, and re-tuning it is #69's.
- **(n) Topic-based search (#369) is the retrieval base for the revision guide and for chat attribution; before it lands, both run on today's fused search.**
  - "Revision notes for a topic" resolves the topic through #369's fact-level index to its facts across lectures, plus semantic neighbours. It is assembled as Ask is, one explanation per topic, verified under (d) and rendered under (i).
  - **Before #369**, question retrieval and per-sentence attribution both go through `CourseIndex.search`'s two fused lists.
    - The keyword half cannot link a sentence about diabetes to a slide about metformin interactions that never says "diabetes".
    - The vector half may link them, since a dense embedder can place the two near each other, but that is unmeasured on this course. The eval carries one synthetic item of that shape ((o)).
  - Neither half guarantees the owner's cross-slide link: a fact tagged `diabetes` on a slide whose words and embedding are all about drug interactions. That link is #369's. Topic membership joins `search` as a third fused list, so chat attribution, and with it the mark's candidates, gains the link without change, because it calls the same `search`.
  - The revision guide depends on #369; chat does not.
- **(o) Evaluation.**
  - `docs/adr/0005-evaluation-as-gate.md` § Decision (b)'s pass condition is read over the explanation:
    - "cites an expected slide" means an expected slide in `sources`;
    - `mustNotContain` matches shown `text`;
    - an uncovered item passes only if the reply is not-covered;
    - the withheld panel stays exempt.
  - The runner asks every golden question **at both depths**, over the same retrieved set.
  - **The contradiction set's deep run is the gate**, at the bar `CLAUDE.md` § Hard constraints sets, and 0005 (e)–(g) are unchanged.
  - **The light depth reports these rows, and none is ever red:**
    - `attributionRecall`: of the expected slides pooled over every covered golden question, the share found in that question's chat attribution set (every sentence's `slides` plus every quoted slide). It mirrors retrieval recall.
    - `contradictionSetLight`: an item passes only if an expected slide is in the attribution set, and every shown sentence containing a forbidden phrase has an expected slide in its `contradicts`. A forbidden phrase marked and linked to the slide it contradicts is chat's mechanism working.
    - `lightFlagRate`: of the set's items whose chat answer shows a sentence containing a forbidden phrase, the share where every such sentence's `contradicts` names an expected slide. It reads `not-measurable` when there are none.
    - `lightFlagRateWide`: the same rate, with the pass re-run offline over every retrieved slide and loaded summary unit plus the candidates — what (g)'s narrow pair set costs.
  - Per-depth rows: `explanationWithheld`, `explanationEntailed` (the findable share of kept sentences at the deep depth) and `quotedShare`. Rows for the summaries and the context: `summaryYield`, `summaryUnitYield`, `sourceCoverage` (slides credited against slides loaded) and `contextOverflow`.
  - **A labelled sentence-kind sample**, `eval/labels/sentence-kind.jsonl` — synthetic and hand-authored against the eval deck — gives `sentenceKindPrecision` and `sentenceKindRecall`. They are baseline rows with no bar (0005 (j)).
  - The contradiction set gains explain-framed items, and one item where the expected slide shares no word with the question.
  - Until the sentence-kind pass lands, the deep run treats every neutral sentence as a course claim, so the gate never lapses.
  - `ATTRIBUTION_K` is chosen by `attributionRecall` across a small sweep of k, in the plan comment of the code that adds it.
- **(p) The prose that moves with this decision.** These change in the PR that lands this ADR:
  - `CLAUDE.md` § Hard constraints — the intro clause and the two bullets this ADR answers, with their headings kept;
  - `README.md`;
  - `docs/plan.md` §§ 1, 3.4, 3.5 and the topic index;
  - `docs/standards/grounding.md` rules 1–10 and § Why;
  - `.claude/ledgers/contradiction-set-bar.ledger`'s claim, deep depth gated and light depth reported;
  - 0001's Status line.
- **(q) What does not change.**
  - "Your slides don't cover this" stays a first-class result.
  - The contradiction set's bar at the deep depth, and that ledger's sweep.
  - 0001 (e)'s framing rule and the generator role for every prompt (0003 (a)).
  - The pipeline order.
  - The reported contract for exams, gold answers and rubric points (0001 (c)–(d) and (h), adopted here for reported units).
  - Resolution's three checks and #367's line lookup.
  - `Verdict`, `PartialPolicy` and the owner of the NLI thresholds.
  - 0004, 0006 (f) and 0008.
  - `RETRIEVAL_K`, `CANDIDATES_PER_LIST`, the generator's context length and their owners.
  - The gateway's capabilities (0003 (b)).
  - **Fine-tuning stays rejected**, for 0001's reasons (its (a) and § Options 1, kept here by reference) and under 0003 (i).
- **(r) What this decision gives up, and when to revisit it.**
  - **Given up:**
    - A caveat the premises neither confirm nor deny is no longer removed at the deep depth (0001 (e) and `mustNotContain` still bound it).
    - **In chat, nothing is removed mechanically.** A sentence a slide contradicts reaches the student marked and linked when the checker scores it so, and unmarked when it does not. A "mainstream medicine says" caveat, or a fact the slides never state, reaches the student with an attribution list beside it. Both are caught by the reported light rows and by the student, never by mechanism. Chat's not-covered rests on the model's own `null`.
    - At the deep depth, an interpretation the slides are silent on reaches the student.
    - There is a generator call per lecture at upload, and one per deep answer that has a neutral sentence; a larger course file; more deep verifier pairs; and an embedder call plus up to `ATTRIBUTION_K` + 1 cross-encoder pairs per chat sentence.
    - Until the code lands, `main` keeps the reported contract for Ask.
  - **Revisit:**
    - if `sentenceKindPrecision` falls below the verifier's precision on the same run;
    - if `contradictionSetLight` fails an item the deep run passes, or `lightFlagRateWide` exceeds `lightFlagRate`. The owner then decides whether the pass widens to the retrieved set, chat goes deep, or the failure class is accepted and named.
    - if `attributionRecall` falls below retrieval recall on the same run;
    - if `explanationEntailed` falls below half on a real deck;
    - if Ask's latency on the target class exceeds 0003 (h)'s tiebreak;
    - if `contextOverflow` is non-zero on a real course;
    - if `sourceCoverage` is low while `contextOverflow` is non-zero or recall is low — the signal that reopens § Options B's read loop.

## Options considered

**A. One explanation from all the retrieved slides, two depths by surface, quotes as marked pointers (chosen).** Its downsides are (r)'s, and they are accepted.

**B. Context shapes.**

- **Whole lectures raw**, whenever they fit the window. Rejected: recall widens past k with no ranking, pairs multiply at the deep depth, and behaviour changes with the window.
- **Raw retrieved slides plus stored lecture summaries.** Chosen ((b), (l)).
- **An agentic read loop.** The generator gets tools — search the course, open a lecture, read around a slide — and the course map as its starting context. Recorded, and not built:
  - The gateway has no tool-calling surface.
  - It would take several generator calls per question on the pinned 4B model.
  - Eval recordings replay per call, so a prompt change invalidates the whole chain.
  - Its premise set becomes the model's choice: what the model does not open cannot contradict it.
  - Hosted agent frameworks are out by `CLAUDE.md` § Hard constraints' egress rule, so any adoption is of the pattern, written against the existing adapter. It reopens on (r)'s last trigger.

**C. How a sentence's kind is decided.**

- **The generator labels its own sentences in the generation call.** Rejected: that is the prompt-trust 0001 § Context refuses.
- **The cross-encoder against a fixed hypothesis frame.** Rejected for now: the pin is trained on pairs of ordinary statements, a frame about a sentence's own kind is outside that, and the frame is blind to the premises. It stays the measured alternative over the labelled sample.
- **A separate judge-prompt call.** Chosen ((e)).

**D. Verification in chat.**

- **One depth for every surface.** Rejected by the owner's answer of 2026-10-27.
- **Q13's three screens** — a contradiction cut with an entailment floor, the cut alone, or no checker at all. Rejected by the owner's answer of 2026-11-02 ("i don't want it to cut any part of the answer").
- **No cross-encoder in chat.** Reversed by the amendment the same day. A mark is not a cut, and a wrong mark costs a glance at a slide shown beside the sentence anyway.
- **Per-answer attribution only.** Rejected in (f).

**E. Every explanation sentence entailed by its quotes**, as 0001 (h) required. Rejected: it is extractive by construction, which is what #367 measured and the owner rejected.

**F. Withholding a whole explanation for one bad sentence.** Rejected: per-sentence withholding at the deep depth keeps what is grounded ((h)).

**G. A separate ADR for the lecture digest.** Rejected: the digest exists for this ADR's context assembly, and splitting it would leave (b) citing a decision not yet made.

**H. A token-counting capability on the gateway** to size the prompt exactly. Rejected for the reason `docs/adr/0008-slide-chunking.md` § Options D gives: an estimate that errs long, tuned against the reported prompt tokens, answers the question without a new capability.

## Consequences

**Easier.** The tutor explains, which is what the owner asked of it, and a student can tell the slide's words from the tutor's at a glance. A chat answer costs one generator call, an embedder call per sentence and one batched cross-encoder pass — no extra generator call on the interactive path. Topic search (#369) improves chat attribution and the guide with no change to either depth.

**Harder.** Two depths means two contracts, held apart by one owned value, and every new surface chooses one. The deep depth adds a judge call and a classifier that has to be measured before it can be trusted. Ingest gains a generator call per lecture, and a missing summary is a new state the decks screen shows.

**Explicitly accepted.** In chat the slides win by a mark and a list the student reads, not by removal; that rests on the owner's answer of 2026-11-02, and its cost is reported, never gated. 0001's guarantee that "a sentence only the base model believes … is withheld" now holds at the deep depth only.

**What would make us revisit.** (r)'s triggers.

## Amendments

- **2026-11-02 — (d) and (g): one entailing premise outweighs any contradiction** (#420, by the owner's decision of 2026-11-02, relayed verbatim: "i think we can rely on the slides not being self contradictory? i.e. one supporting match outweighs any contradictions? perhaps we could do some kind of self contradiction checks when we're injesting the slides so we can clarify the context around different statements to ensure we don't get wires crossed? (that can be tackled separately ofc)").
  - Was: at the deep depth, a sentence is contradicted if any premise scores contradiction at or above `contradictedAt`, whatever the others score. At the light depth, `contradicts` lists every one of the sentence's slides that scores so.
  - Now: at both depths, a sentence that any premise scores at or above `entailedAt` for entailment is never contradicted. A contradiction counts only when no premise entails the sentence. At the deep depth an over-length pair is judged, by the second opinion or fail-closed, only when no scored premise entails. The code that owns this is `packages/grounding/src/verify-explanation.ts` (deep) and `packages/grounding/src/mark-contradictions.ts` (light).
  - Why it moved: the pinned cross-encoder scores contradiction at 0.9–1.0 between a sentence and a slide on another subject. #420's live run, on the synthetic deck with every golden question at both depths, is in its plan comment. The deep contradiction set went from 11/22 to 20/22 under this rule, and light marks went from 25/42 sentences to 4/42. A1 had measured contradiction recall alone.
  - What the rule assumes: the slides do not contradict themselves. Checking that at ingest is a separate issue.
  - Trued up in the same change, as mutable quoters: `CLAUDE.md` § Hard constraints ("Nothing the tutor says is uncited", "The slides win"), `README.md` (intro and the "slides win" paragraph), `docs/standards/grounding.md` rule 4, and `docs/plan.md` § 1 and the Ask flow.
  - Annotated in this file: (d)'s Stage 1 class order and (g)'s `contradicts` bullet.
  - Sweep: case-insensitive `contradict` over the tracked tree, less the eval recordings and reports, the three append-only logs, ADRs 0001, 0003 and 0005, test files and `eval/questions.jsonl`, run at `f9019d4` on 2026-11-02 for branch `420-explanation-answers` (rc 0, 177 hits). The hits outside this file that state the rule are the quoters above. The rest name the contradiction set, the `contradicted` reason, the score field or the word in another sense. 0001, 0003 and 0005 are immutable and describe the reported tier, which this does not touch.
