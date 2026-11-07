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
    - `sentences` holds one `AttributedSentence = {text, slides, contradicts}` per sentence of `text`. At the light depth, `slides` are the candidates a search found ((f)); at the deep depth, the slides whose text entailed the sentence ((d)). `contradicts` lists the slides the checker scores as contradicting the sentence, best-scoring first, and is empty when none does ((g)). _(Quoted as it stood when this was written. Since 2026-11-02, `contradicts` is also empty when any of the sentence's slides entails it; see § Amendments.)_ It is always empty in shown deep output, where a contradicted sentence is cut and the withheld entry names its slide ((h)).
    - `sources` is every slide named in `quotes` or `sentences`, numbered in first-use order, at least one. _(Quoted as it stood when this was written. Since 2026-11-02, when nothing is named, `sources` is the retrieved set; see § Amendments.)_
    - `ExplanationSurface = 'ask' | 'revision-guide'` sits beside it.
  - A _reported unit_ is today's `Unit`, for exam questions, gold answers, rubric points and lecture-summary lines. `UnitKind` gains `lecture-summary` and loses `answer-sentence` and `note-bullet`.
  - A _lecture summary_ is `{lectureId, units}`, its units reported units.
  - Beyond those three shapes, model output reaches the student as 0001 (b)'s two non-claims (a label from a closed enum, a topic tag) and nothing else, and the fixed system strings are not model output. That list is closed.
  - `AskReply`'s grounded arm carries `{explanation, withheld, slides, leftOut, searched?}`; `slides` records every slide the reply names (the retrieved set, the candidates and the contradicting slides). The not-covered arm keeps `{withheld, slides, searched?}` and gains `leftOut`.
- **(b) The pipeline order holds — retrieve → generate → resolve → verify → report — and generation begins with assembly.**
  - `assembleContext` (pure, `packages/grounding/src/assemble-context.ts`) takes the retrieved slides best-first, the stored summaries of their lectures ((l)) and the prompt budget ((j)). It returns `{raw, summaries, leftOut}`. The prompt puts its fixed text first, then the raw slides, then the summaries. _(Quoted as it stood when this was written. Since 2026-11-07, in chat the carried turns of a thread follow the summaries, before the question, as context and never as a source; see § Amendments.)_
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
  - Sentences are `splitClaims`'s. The premises are every raw slide's text and every loaded summary unit's text, each attributed to its slide or slides. _(Quoted as it stood when this was written. Since 2026-11-03, a slide of several lines is scored whole and by each of its lines; see § Amendments.)_
  - **Stage 1, the cross-encoder**, scores every (sentence, premise) pair and labels each sentence with `nli-verdict.ts`'s class:
    - **contradicted** if some premise scores contradiction at or above `contradictedAt`;
    - otherwise **entailed** if some premise scores entailment at or above `entailedAt`;
    - _(The order of these two bullets is quoted as it stood when this was written. Since 2026-11-02, entailed is read first, and a sentence any premise entails is never contradicted; see § Amendments.)_
    - otherwise **neutral**.
  - A contradicted sentence is withheld as `contradicted`, naming the first such premise's slide. An entailed sentence is kept, and its `slides` are those premises' slides.
  - **Stage 2** ((e)) classifies only the neutral sentences, each as a **course claim** or an **interpretation**. A neutral course claim is withheld as `unsupported`; a neutral interpretation is kept.
  - **The explanation is shown if at least one kept sentence is entailed.** Otherwise it is withheld whole as `ungrounded`, and the reply is not-covered. There is no `partial`.
  - An over-length pair goes to `docs/adr/0003-model-roles-and-backends.md` § Decision (d)'s second opinion. With no second opinion configured, it counts as contradicted (fail closed). _(Quoted as it stood when this was written. Since 2026-11-02, an over-length pair is judged only when no scored premise entails the sentence; see § Amendments.)_
  - So every claim about the course is findable, interpretation is bounded by non-contradiction, and the model never labels its own output in the call that wrote it.
  - **These cuts exist at the deep depth only.**
- **(e) The sentence-kind pass: the generator under a judge prompt, over the neutral sentences only, after the cross-encoder.**
  - A separate generator call under `prompts/sentence-kind-prompt.ts` takes the neutral sentences, numbered, and the premises. It returns one kind per sentence as constrained JSON. That is the shape 0003 (a) already uses for the verifier's LLM arm.
  - The prompt follows `docs/standards/grounding.md` rule 6: it asks what kind of sentence each is, never whether it is true.
  - The pass is skipped when no sentence is neutral, and never runs at the light depth.
  - It fails closed. A `model-failed` or invalid reply, or a reply whose length differs from the input's, classifies every neutral sentence as a course claim.
  - The rejected shapes are in § Options C.
- **(f) Two verification depths, chosen by surface; the depth is an owned value; the light depth cuts nothing.**
  - `VerificationDepth = 'deep' | 'light'` sits in `packages/shared/src/verification.ts`. The per-surface choice, `VERIFICATION_DEPTH`, is owned by `packages/shared/src/verification-depth.ts` (moved 2026-11-03; see § Amendments), and its restatement ledger is declared with the code that adds it. Until then, this point is the rule.
  - **Deep — exam questions, gold answers, rubric points and lecture-summary lines, under the reported contract (every unit's claims entailed by its cited lines, policy `drop`), and revision guides, under (d).** The contradiction set is held at its bar here.
  - **Light — chat (Ask).** The pipeline is retrieval → assembly ((b)) → one generator call → pointer resolution ((c)) → **attribution** → **the contradiction mark** ((g)) → report. _(Quoted as it stood when this was written. Since 2026-11-07, a follow-up turn's retrieval runs on a standalone rewrite, one generator call before it; see § Amendments.)_
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
  - **The light pass** (`packages/grounding/src/mark-contradictions.ts`, pure over an injected `entail`) runs after attribution. It makes one batched `verifier.entail` call over each sentence paired with each of its own `slides`, with a whole slide's text as the premise. _(Quoted as it stood when this was written. Since 2026-11-03, each slide is scored whole and by each of its lines; see § Amendments.)_
    - A sentence's `contradicts` is the slides whose pair scores contradiction at or above `contradictedAt` — the deep Stage 1's class exactly — best-scoring first. _(Quoted as it stood when this was written. Since 2026-11-02, `contradicts` is empty when any of the sentence's slides entails it; see § Amendments.)_
    - An over-length pair gives no mark from that slide. Chat gets no second opinion, because that would be a generator call on the interactive path; the eval report counts such pairs. _(This bullet and the one above are quoted as they stood when this was written, at one pair per slide. Since 2026-11-03 a slide may be several pairs, and only its over-length ones give no mark; `scoredPremises` in `packages/grounding/src/premise.ts` owns which. See § Amendments.)_
  - **Why only the sentence's own slides.** Cost is pairs × time per pair, and `OnnxVerifier.entail` runs pairs one by one. The committed eval reports put a verifier call at ~30 ms on the dev class, so a ten-sentence answer at a small `ATTRIBUTION_K` costs about a second. Adding the whole retrieved set to every sentence would cost about three times that before summaries join. _(These figures are quoted as they stood when this was written, at one pair per slide. Since 2026-11-03 `scoredPremises` in `packages/grounding/src/premise.ts` decides how many pairs a slide is; the measured cost is in § Amendments.)_
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
  - Nothing in `text` marks a quote. The renderer locates each `quotes[i].quote` in `text` and renders it as a quotation followed by its source number. _(Quoted as it stood when this was written. Since 2026-11-04, a quotation from a derived slide, and every source number naming one, also carry the derived label; see § Amendments.)_
  - After each sentence, its `slides` appear as source numbers under a per-depth label: `MAY_BE_RELEVANT` at the light depth.
  - Prose carries no number (`docs/standards/design.md` rule 2).
  - **The contradiction mark — a design decision under `docs/standards/design.md` rules 2 and 9.**
    - A sentence with a non-empty `contradicts` is rendered in a `.contradicted` span. Its always-visible mark is a `--color-danger` underline, wavy, at `--line-sm`, in regular weight. Style, weight and hue tell it apart from the quote mark (solid `--color-accent`, heavier, semibold) in both themes.
    - The owner's "red" is the danger token — a meaning, never a value.
    - Its reference cluster holds the contradicting slides' numbers, each a button that opens the slide panel (`apps/web/src/ask/SlideDialog.tsx`) on that slide.
    - The words "appears to contradict" (`APPEARS_TO_CONTRADICT`) are **not permanent**: they appear on hover over the marked sentence and on keyboard focus of its contradiction button. That follows the owner's PROCEED of 2026-11-02: "can the appears to contradict be on hover not permanent".
    - The mark never relies on colour alone. Sighted readers get the wavy style. Assistive technology gets an accessible name on each contradiction button: the label, the lecture title and the slide number (`contradictionRefLabel`). That is design.md rule 2's move — a label for assistive technology becomes an accessible name — and the button is the span's one focusable element. _(Quoted as it stood when this was written. Since 2026-11-04, the name of a button naming a derived slide also ends with the derived label; see § Amendments.)_
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
- **(l) The lecture digest — the course map.** _(This point is quoted as it stood when this was written. Since 2026-11-05 the digest is two artefacts, a prompt map and student notes, and the unit summary it describes retires once both ship; until then it is what `main` runs. See § Amendments.)_
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
    - There is a generator call per lecture at upload, and one per deep answer that has a neutral sentence; a larger course file; more deep verifier pairs; and an embedder call plus up to `ATTRIBUTION_K` + 1 cross-encoder pairs per chat sentence. _(Quoted as it stood when this was written, at one pair per slide. Since 2026-11-03 each of those slides is scored whole and by each of its lines; see § Amendments.)_
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

**Easier.** The tutor explains, which is what the owner asked of it, and a student can tell the slide's words from the tutor's at a glance. A chat answer costs one generator call, an embedder call per sentence and one batched cross-encoder pass — no extra generator call on the interactive path. _(Quoted as it stood when this was written. Since 2026-11-07 a follow-up turn pays one more generator call, the standalone rewrite, before retrieval; see § Amendments.)_ Topic search (#369) improves chat attribution and the guide with no change to either depth.

**Harder.** Two depths means two contracts, held apart by one owned value, and every new surface chooses one. The deep depth adds a judge call and a classifier that has to be measured before it can be trusted. Ingest gains a generator call per lecture, and a missing summary is a new state the decks screen shows.

**Explicitly accepted.** In chat the slides win by a mark and a list the student reads, not by removal; that rests on the owner's answer of 2026-11-02, and its cost is reported, never gated. 0001's guarantee that "a sentence only the base model believes … is withheld" now holds at the deep depth only.

**What would make us revisit.** (r)'s triggers.

## Amendments

- **2026-11-02 — (d) and (g): one entailing premise outweighs any contradiction** (#420, by the owner's decision of 2026-11-02, relayed verbatim: "i think we can rely on the slides not being self contradictory? i.e. one supporting match outweighs any contradictions? perhaps we could do some kind of self contradiction checks when we're injesting the slides so we can clarify the context around different statements to ensure we don't get wires crossed? (that can be tackled separately ofc)").
  - Was: at the deep depth, a sentence is contradicted if any premise scores contradiction at or above `contradictedAt`, whatever the others score. At the light depth, `contradicts` lists every one of the sentence's slides that scores so.
  - Now: at both depths, a sentence that any premise scores at or above `entailedAt` for entailment is never contradicted. A contradiction counts only when no premise entails the sentence. At the deep depth an over-length pair is judged, by the second opinion or fail-closed, only when no scored premise entails. The code that owns this is `packages/grounding/src/verify-explanation.ts` (deep) and `packages/grounding/src/mark-contradictions.ts` (light).
  - Why it moved: the pinned cross-encoder scores high contradiction between a sentence and a slide on another subject. A1 had measured contradiction recall alone. The measurements before and after the rule are #420's plan comment (https://github.com/TomBennett-Lloyd/cram.ai/issues/420#issuecomment-6578621768).
  - What the rule assumes: the slides do not contradict themselves. Checking that at ingest is a separate issue.
  - Trued up in the same change, as mutable quoters: `CLAUDE.md` § Hard constraints ("Nothing the tutor says is uncited", "The slides win"), `README.md` (the intro, the "slides win" paragraph and § How it works), `docs/standards/grounding.md` rule 4, `docs/plan.md` § 0 and the Ask flow, and `AttributedSentence`'s docblock in `packages/shared/src/explanation.ts`.
  - Annotated in this file: (a)'s `contradicts` definition, (d)'s Stage 1 class order and over-length bullet, and (g)'s `contradicts` bullet.
  - Sweep: `git grep -n -I -i -P -e 'contradict|conflicts? with|disagree|at odds with' -- ':/' ':!eval/recordings' ':!eval/reports' ':!docs/review-feedback.md' ':!docs/friction-log.md' ':!docs/tech-debt.md' ':!docs/adr/0001*' ':!docs/adr/0003*' ':!docs/adr/0005*' ':!*.test.ts' ':!*.test.tsx' ':!eval/questions.jsonl'`. It was run at `fc8bd2a` on 2026-11-02 for branch `420-explanation-answers`: rc 0, 204 hits, with `CLAUDE.md:11` as the positive control. The hits that state the rule are the quoters and annotations above, and the two owning files. The rest name the contradiction set, the `contradicted` reason, the score field, or the word in another sense (scripts, `docs/standards/evidence.md`, `docs/adr/README.md`, 0008). 0001, 0003 and 0005 are immutable and describe the reported tier, which this does not touch. An earlier pass with `contradict` alone, at `f9019d4`, missed `README.md`'s § How it works, `AttributedSentence`'s docblock, and (a) and (d)'s over-length bullet here; review found them.
- **2026-11-02 — (a): with no slide named, `sources` is the retrieved set** (#420, from its review; proposed in that PR for the owner's approval).
  - Was: `sources` is every slide named in `quotes` or `sentences`, at least one.
  - Now: the same, except when no sentence names a slide and no quote is shown. That happens when every sentence is longer than the embedder takes, so its search returns nothing. In that case `sources` is the retrieved set the explanation was written from, best first. Before this, the reply failed with a server error. The code that owns this is `shown` in `packages/grounding/src/explain.ts`.
  - Annotated in this file: (a)'s `sources` bullet.
- **2026-11-03 — (d) and (g): a slide is scored whole and line by line** (#439; proposed in PR #499 for the owner's approval).
  - Was: at the deep depth each raw slide was one premise, its whole text. At the light depth each of a sentence's slides was one pair, its whole text.
  - Now: at both depths a slide is scored whole and then by each of its distinct lines. These are the lines citations number (`slideLines` in `packages/grounding/src/slide-text.ts`). Each line credits that slide. A slide of one line is scored once, and so is a summary unit. The 2026-11-02 entailment-wins rule reads over all of them, so a line that entails a sentence clears a contradiction from the slide whole or from any other line. The sentence-kind judge ((e)) is still shown each slide whole. The code that owns this is `scoredPremises` in `packages/grounding/src/premise.ts`, which `verify-explanation.ts` (deep) and `mark-contradictions.ts` (light) call.
  - Why it moved: the pinned cross-encoder dilutes a line's entailment across a whole slide. "Worker bees are male." scored entailment 0.002 against the whole of lecture-01 slide 3 and 0.995 against that slide's own line (#420's lane). A1 had measured recall only. Measured on the eval course, with the generator replayed from report `1525628`'s recordings and the cross-encoder live, then confirmed by the live run, report `3187da0`:

    | Premise shape                        | Deep set | Light set | Deep sentences withheld | Chat marks | Mean pairs per deep answer |
    | ------------------------------------ | -------- | --------- | ----------------------- | ---------- | -------------------------- |
    | whole slide (before)                 | 20/22    | 21/22     | 11/53                   | 6/53       | 57                         |
    | each line alone                      | 22/22    | 21/22     | 13/53                   | 12/53      | 105                        |
    | whole slide, then each line (chosen) | 22/22    | 21/22     | 5/53                    | 3/53       | 119                        |

    The chat marks are counted over the light run's 53 sentences. With the slide whole, all six marked sentences say what the deck says, so all six marks are false. With the chosen shape, two of the three remaining marks are false: "Bees sleep through the winter." and its next sentence, whose own slide (lecture-05 slide 6) the sentence's search did not find. The third marks a sentence the deck does not say: it takes an item of lecture 6's outline for a step of its inspection checklist. `attributionRecall` stays 41/47 in every shape, because it reads the search alone.

  - Lines alone were rejected for two reasons. Some sentences are entailed by a slide whole and by none of its lines alone: lines alone withheld 13 of 53 deep sentences, against 5 for the chosen shape. Lines alone also doubled the marks in chat, from 6 to 12.
  - Cost, from report `3187da0`: 3674 pairs over 31 deep answers, at most 279 in one answer (the new `deepPairs` row). The chat mark sent 864 pairs over 31 answers, up from 161. Ask's median latency on the dev class went from 3460 ms to 3808 ms. (r)'s Ask-latency trigger is unchanged, and it covers the chat mark's cost.
  - Annotated in this file: (d)'s premises bullet; in (g), the light-pass bullet, its `contradicts` and over-length bullets, and its cost bullet; and (r)'s pairs-per-chat-sentence clause.
  - Sweep: three arms, each `git grep -n -I -i -P "<arm>" 860916f -- ':/' ':/!eval/recordings' ':/!eval/reports' ':/!docs/review-feedback.md' ':/!docs/friction-log.md' ':/!docs/tech-debt.md' ':/!docs/adr/0001*' ':/!docs/adr/0003*' ':/!docs/adr/0005*'`, run on 2026-11-03 at `860916f` (branch `439-per-line-premises`, this entry's first draft, before review), all rc 0.
    - Arm 1, the premise shape: `premises? (are|is|was)\b|whole[- ]slide|a slide'?s (whole |own )?text|as the premise|every raw slide|slidePremise|contextPremises|scoredPremises|premise per|per[- ]line`. It returned 79 hits, with this file's (d) premises bullet as the positive control.
    - Arm 2, the pair cost: `pairs? (per|×|x)|cross-encoder pairs|ATTRIBUTION_K.? \+ 1|sentences? × |× (its|the) (own )?slides|one pair (per|each)`. It returned 6 hits: (g)'s cost bullet (the control), (r)'s pairs-per-chat-sentence clause, this entry's table and sweep lines, `eval/README.md:17`, and `mark-contradictions.test.ts:42`.
    - Arm 3, one pair per slide: `whose pair|pair (gives|scores)|from that slide`. It returned 5 hits: (g)'s `contradicts` and over-length bullets (the control), and three uses in another sense, in `DecksSummaryLines.test.tsx`, 0006's per-slide action and `onnx-reranker.test.ts`. Review found these two (g) bullets after arms 1 and 2 had missed them.
    - Besides the annotations above, three hits state the shape. `eval/src/sentence-kind-label.ts`'s docblock is trued up in the same change. `mark-contradictions.test.ts`'s test title is renamed. `packages/grounding/src/prompts/sentence-kind-prompt.ts` ("The premises are the slides") stays true, because the judge keeps whole slides.
    - The rest use "per line" or "whole slide" in another sense: one-entry-per-line formats, 0008's chunking, and ingest. 0001, 0003 and 0005 describe the reported tier, which this does not touch.
- **2026-11-03 — (f): `VERIFICATION_DEPTH` is owned in `@cram/shared`** (#465, found by #421's review).
  - Was: `VERIFICATION_DEPTH` is owned by `packages/grounding/src/verification-depth.ts`.
  - Now: it is owned by `packages/shared/src/verification-depth.ts`, in the same package as `VerificationDepth`. The value is unchanged: Ask is light and the revision guide is deep. It moved because `apps/web` cannot depend on `@cram/grounding`, which pulls in `@cram/gateway`'s native runtimes. So the web had restated Ask's depth as its own constant, a second copy of the owned value. The web now reads the owner, and that copy is gone.
  - Trued up in the same change, as mutable quoters: `.claude/ledgers/verification-depth.ledger` (its `owner:`), and the imports in `packages/grounding/src/ask.ts`, `eval/src/ask-depths.ts` and `apps/web/src/ask/AnswerView.tsx`. Inline in this file: (f)'s owner path, which is a carrier that nothing leans on.
  - Sweep: `git grep -n -I -i -P -e 'verification-depth|VERIFICATION_DEPTH|ASK_DEPTH|depth.{0,60}(owned|owner|restated|cannot import)|(cannot|can.t) import .{0,30}@cram/grounding' -- ':/'`. It was run at `a0e67a0` on 2026-11-03 for branch `465-verification-depth-shared`: rc 0, 25 hits. Its positive controls were the old owner file, the web's restatement and (f) here. `CLAUDE.md`, `docs/plan.md`, `docs/standards/grounding.md` and `eval/README.md` carry the depth claim but not the owner's path, so none of them changes. The ledger lists those quoters.
- **2026-11-04 — (i): a quotation from a derived slide, and every number naming one, carry the derived label** (#464, found by #421's review; by the owner's decision of 2026-11-04, relayed verbatim: "Label the in-text references too.").
  - Was: a quotation from a derived slide, and the number after it, looked and were named exactly as a typed slide's were. `docs/standards/grounding.md` rule 10 asks for the derived label on every reference to derived text, and `docs/adr/0006-image-only-slides.md` § Decision (f) asks for it on the quote, so they and (i) disagreed.
  - Now: rule 10 and 0006 (f) stand as written, and (i) follows them.
    - A quotation whose line is quoted from any derived slide keeps the quote mark's hue and weight, and its underline is dotted rather than solid. Every source number naming a derived slide takes the same dotted underline, whether it follows a quotation, a contradicted sentence or a sentence's slides.
    - Style alone tells the dotted mark from the quote's solid underline and the contradiction's wavy one, in both themes (`docs/standards/design.md` rule 9). Dashed is not used, because `.tag[data-origin='tagger']` in `apps/web/src/app.css` already carries it.
    - The words are each such number's accessible name: `sourceRefLabel` and `contradictionRefLabel` end it with `DERIVED_SOURCE`, the sources entry's visible label. They are not shown beside every number, because the number's sources entry already shows them (`docs/standards/design.md` rules 2 and 10).
  - The code that owns this is `apps/web/src/ask/ExplanationView.tsx`, with the names in `apps/web/src/copy.ts` and the treatment in `apps/web/src/app.css`. `apps/web/e2e/ask.spec.ts` asserts the treatment.
  - Annotated in this file: (i)'s quotation bullet and its accessible-name bullet.
  - Sweep: `git grep -n -I -i -P -e 'labell?ed (as )?derived|derived label|label(s|led)? (the quote|a derived)|DERIVED_SOURCE|slide-card-derived|read from (the|a) (slide.s )?picture' -e 'sourceRefLabel|contradictionRefLabel|accessible name.{0,80}(source|number|contradiction)' -- ':/' ':/!eval/recordings' ':/!eval/reports'`, run at `00f46fa` on 2026-11-04 for branch `464-derived-in-text-label`: rc 0, 42 hits. Its positive controls were `docs/standards/grounding.md` rule 10, 0006 (f)'s Ask bullet, and (i)'s sources bullet and accessible-name bullet here. Rule 10 and 0006 (f) stand by the owner's decision. The reason each other hit stays unedited is in the plan comment's "Unedited hits and why" list: https://github.com/TomBennett-Lloyd/cram.ai/issues/464#issuecomment-6643411095. The slide panel's `DERIVED_TEXT` (`apps/web/src/copy.ts`), which the `DERIVED_SOURCE` arm cannot find, also stays true and does not change.
- **2026-11-05 — (l): the lecture digest splits into a prompt map and student notes, and the unit summary retires once both ship** (#587, by the owner's decision of 2026-11-04, relayed verbatim: "nice yeah that direction is right for the lecture summaries, i agree we should retire the old one once we have the new system"; the owner's finding on their own deck, #580: the summary "is not very useful in its current form". #580's measurement folds in here).
  - Was: one artefact served two readers. `summariseLecture` made one reported call per lecture — one per part when the lecture overflowed the prompt budget — at upload, at each rebuild and on a re-make from the decks screen, for at most `SUMMARY_MAX_UNITS` units, each verified under the reported contract with `partial` dropped. The survivors, in slide order, were both what `CourseIndex.summary` loaded into the Ask prompt beside the retrieved slides ((b)) and what the student read on the decks screen.
  - Why it moved: the unit rule selects for restated lines, so what the student read was whichever drafted units most resembled a slide line; a lecture was cut into parts at token-budget boundaries rather than at its sections; and a part whose units all failed left a silent gap (#580; since #569 the withheld units are shown beside the survivors). The pinned 4B does one heading-bounded call over a handful of slides well, and one call over a whole lecture for twelve units badly.
  - Now, in four points.
    1. **The map, for the prompt.** A lecture's map is its title, its sections in order, and the topic tags of each section's chunks. A section is a run of consecutive slides under one stored heading — the slide record's `title`, which ingest sets from the format's marked title or from the text layer (#9; #567's layout). Where headings do not run — the eval deck's lectures title every slide differently — the code that adds the map groups consecutive slides by a shared tag and then by a bounded window, and owns that rule with its ledger. The map is not model output: its words are the slides' own headings as ingest stored them, and its tags are 0001 (b)'s second non-claim, which #426's pass already writes at ingest. So the map needs no verifier, and (a)'s closed list is unchanged. It replaces the units as what `CourseIndex.summary` loads into the prompt under (b), and it is derived from stored metadata: no generator call, and no table of its own. At most one or two verified lines per section join the map only if its eval shows Ask needs them — `attributionRecall` and the contradiction set with the map in the prompt, against the same run with the units — and such a line is a reported unit under (f)'s deep contract, as a summary unit is today.
    2. **The notes, for the student.** A lecture's notes are explanations — (a)'s first shape — written section by section from that section's slides, under the lecture's own headings, in the regime (d) gives a revision guide: the sentences are `splitClaims`'s; the premises are the section's slides, scored as (d) stands since 2026-11-03; a claim about the course is withheld as `unsupported` unless a premise entails it; a sentence a premise contradicts and none entails is withheld as `contradicted`; and an interpretation is kept and shown with a label that it is supplementary, by the owner's decision on #459 of 2026-11-04, whose wording and stored form that issue's plan decides. Every sentence shows its slides beside it under (i), and a quoted line is a marked pointer under (c). A section whose explanation is withheld whole as `ungrounded` is shown under its heading as withheld, never left as a gap (`docs/standards/grounding.md` rule 7). The notes never enter a prompt; the map does.
    3. **When the notes are made.** On demand, per lecture, from the decks screen, which offers to make them as it offers the summary today. They are cached in the course file as derived data (`docs/adr/0004-storage.md` § Decision (d)), so the file's version counter moves in the change that adds them. A re-upload of the lecture and a rebuild of the course discard the cached notes, which are made again at the next request — never at ingest. The cost that decides it, from the committed report `f95be65` on the dev class: a generator call's median is about 2.3 s, a verifier pair's about 31 ms, and a deep explanation sends about 120 pairs (the 2026-11-03 entry). So a section costs one generator call, at most one judge call and a few seconds of pairs — of the order of ten seconds — and a lecture of the eval deck's size about a minute. At ingest that is about an hour of background generation for (m)'s sixty-lecture course, spent on lectures the student may never open; on demand it is a wait of about a minute for each lecture opened, once. The map costs nothing at ingest beyond the tags already made.
    4. **The unit summary retires** once 1 and 2 ship: `summariseLecture`'s unit path and `SUMMARY_MAX_UNITS`; the `lecture_summaries` table and `LectureDigest`; the decks screen's summary and its re-make; `UnitKind`'s `lecture-summary`; and (o)'s `summaryYield` and `summaryUnitYield` rows — each with its own sweep, in the change that retires it. #569's withheld storage carries over to the notes' withheld sentences. The map and the notes each declare a restatement ledger with the code that adds them, as (f) did.
  - What the eval measures (#580's rows, applied to the notes): per lecture, sections found, sentences drafted, claims withheld, interpretations labelled, and slide coverage — the share of the lecture's slides some kept sentence cites — reported under (o) beside the contradiction set and never gated. Ask with the map in the prompt against the units: `attributionRecall` and the contradiction set unchanged or better, measured in the change that adds the map.
  - Until the map and the notes land, `main` keeps the unit summary this file describes, so every quoter of it stays true and none is trued up in this change. Each moves with the change that retires what it states, and the hit-by-hit list is in #587's plan comment. With the map: `README.md` § How it works, `docs/plan.md` §§ 3.2 and 3.5 (the Ask flow), `docs/standards/grounding.md` rules 2 and 10, `eval/README.md`, and the loaders and prompt blocks in `packages/grounding/src/assemble-context.ts`, `premise.ts`, `prompts/source-block.ts`, `prompts/sentence-kind-prompt.ts`, `packages/index/src/loaded-summaries.ts`, `apps/server/src/ask-course.ts` and `eval/src/ask-depths.ts`. With the retirement: `CLAUDE.md` § Hard constraints (a path only the owner approves, so that change waits for the owner's review), `docs/standards/grounding.md` rules 1 and 4, `packages/shared/src/unit.ts` and `lecture-summary.ts`, `packages/grounding/src/summarise-lecture.ts` and `prompts/generation-prompt.ts`, `packages/index/src/lecture-summaries.ts`, `course-index.ts`, `stored-lectures.ts`, `rebuild-course.ts` and `list-filter.ts`, `apps/server/src/lecture-digest.ts`, `ingest-queue.ts`, `handlers.ts` and `routes.ts`, `apps/web/src/decks/` and `apps/web/src/copy.ts`, and `eval/src/summary-rows.ts`.
  - Annotated in this file: (l)'s heading. The other mentions of the summary as units — (a)'s reported-unit and lecture-summary shapes, (b)'s loaded summaries, (d)'s summary-unit premises, (f)'s deep surfaces, (k), (m), (o)'s summary rows, (r)'s per-lecture call and § Consequences — are declared historical here as one family, and read as current until the retirement lands.
  - Sweep: three arms, `git grep -n -I -i -P -e '<arm 1>' -e '<arm 2>' -e '<arm 3>' -- ':/' ':/!eval/recordings' ':/!eval/reports' ':/!docs/review-feedback.md' ':/!docs/friction-log.md' ':/!docs/tech-debt.md' ':/!*.test.ts' ':/!*.test.tsx' ':/!*.test.sh' ':/!pnpm-lock.yaml'`, run on 2026-11-05 at `8e16791c` (branch `587-lecture-notes-split`, before the first edit): rc 0, 292 hits in 59 files, tests excluded because they retire with the code they assert.
    - Arm 1, the mechanism's names: `SUMMARY_MAX_UNITS|lecture_summaries|lecture-summary|LectureSummary|LectureDigest|summariseLecture|summaryParts|digestOf|setDigest|readSummary|readDigests|loadSummaries|summariesFor|SUMMARISED_LECTURES|summaryYield|summaryUnitYield|remake-summary|course-summaries|SummaryRemakeRequest|CourseSummaries|LoadedSummary|§ Decision \(l\)`, with (l)'s `summariseLecture` bullet in this file as the positive control.
    - Arm 2, the claim: `summary (line|unit)s?|digest line|lecture.summary line|course map|stored summar|lectures?.{0,3} summar(y|ies)|summar(y|ies|ise[ds]?|ising) (at|on|after|per) (upload|ingest|lecture)|generator call per lecture|re-?ma(de|ke)`, with `CLAUDE.md`'s "lecture-summary line is a _unit_" as the positive control.
    - Arm 3, the student's surface: `Make the summary|decks screen.{0,80}summar|summar.{0,80}decks screen|MAKE_SUMMARY|NO_SUMMARY|SUMMARY_FAILED|SUMMARY_ALL_WITHHELD|SUMMARY_REPLACED`, with `MAKE_SUMMARY` in `apps/web/src/copy.ts` as the positive control.
    - Every hit but eleven is a quoter listed above, a test fixture or a type export that retires with it, or a citation of (l) that now reads the annotation. The eleven in another sense: `docs/adr/0003-model-roles-and-backends.md` and `docs/adr/0007-desktop-packaging.md` (an artefact's digest), `docs/standards/evidence.md` rules 7 and 12 and `.claude/agents/ticket-agent.md` (a report's summary line), `.claude/skills/plan-issue/SKILL.md` (a quotation of #422's acceptance), `.claude/comment-density.baseline.tsv` (two file paths), `apps/web/src/app.css` and `apps/web/e2e/decks-summary.spec.ts` (the `summary` element of a `details`), and `packages/index/src/list-filter.ts` (exam generation's listing, which rule 10 owns). Open PRs at the run: #645 amends (i) and appends to this section, and #646 touches hooks; neither states (l). 0001, 0003 and 0005 are immutable and describe the reported tier, which the map's optional lines keep.
- **2026-11-07 — (b), (f) and § Consequences: Ask holds a conversation** (#576; extended by `docs/adr/0011-ask-conversation.md`, whose plan the owner approved).
  - Was: a chat answer's prompt held the fixed text, the raw slides and the summaries, and one question; a chat answer cost one generator call.
  - Now: a follow-up turn carries the thread's newest turns in the prompt after the summaries, as context the fixed text names as not a source, and its retrieval runs on a standalone rewrite, one generator call before the answer's. 0011 § Decision (a)–(e) owns the rule; the code is `packages/grounding/src/turn-window.ts`, `packages/grounding/src/standalone-question.ts` and `packages/grounding/src/prompts/explanation-prompt.ts`.
  - (g)'s reason for no second opinion in chat — no generator call on the interactive path — now reads: none after the answer. The second opinion stays deep-only.
  - Annotated in this file: (b)'s assembleContext bullet, (f)'s Light bullet and § Consequences' cost sentence.
  - Trued up in the same change, as mutable quoters: `docs/standards/grounding.md` rule 2, `docs/plan.md` § 3.5 "Ask a question", `apps/server/src/handlers.ts`'s `MAX_ASK_BYTES` docblock, `packages/shared/src/ask.ts`'s `searched` docblock and `apps/web/src/ask/use-ask.ts`'s docblock (the file is replaced). The sweeps are in #576's plan comment.
