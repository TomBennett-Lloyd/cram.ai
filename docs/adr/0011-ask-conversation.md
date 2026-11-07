# 0011 — Ask holds a conversation: follow-up turns, a standalone retrieval rewrite, earlier answers never a source

- **Status:** proposed
- **Date:** 2026-11-07
- **Issue:** #576

## Context

Ask answers one question and stops. There is no conversation state in the web client, the server or the shared schemas, and a student cannot ask a follow-up that refers to the answer just given. The owner's decision of 2026-11-04, after #423's local check, verbatim: "i definitely want the conversation feature".

A follow-up turn needs three things (#576):

1. **The earlier turns in the prompt, inside the existing budget.** `docs/adr/0009-explanation-answers.md` § Decision (b) assembles one question's prompt under `PROMPT_TOKEN_BUDGET` ((j)) and reports what it left out ((k)). Earlier questions and answers spend the same budget, so how many are carried is a tuned input with one owner (`docs/standards/architecture.md` rule 12).
2. **A self-contained retrieval query.** "What about the next phase?" retrieves nothing on its own. A follow-up has to be rewritten into a standalone question before search. That rewrite is a new model output: the student never reads it and it is never a source, but it decides what is retrieved, so the eval measures it.
3. **The earlier answer is the tutor's words, never a source.** 0009 (a) and (b) govern what the tutor may speak from, and 0009 (f)–(i) govern how a chat answer is attributed and marked. An earlier answer may help interpret the question and write the rewrite. No sentence is ever attributed to it.

0009 describes a chat answer's inputs and cost, and this changes both. It is a new decision, not a moved value, and `docs/adr/README.md` § Amendments says an amendment never touches reasoning. 0010 set the precedent: a new ADR extends the old one, and the old one carries dated annotations pointing here. The owner approved this form with the plan (#576's plan comment, Q6).

## Decision

- **(a) A thread is the client's, session-only, and the request carries it.** `AskRequest` (`packages/shared/src/ask.ts`) is `{question, turns}`. A turn (`AskTurn`) is `{question, answer}`, where `answer` is the shown explanation `text` of an earlier grounded reply, or `null` for a not-covered one — the same idiom as `GeneratedExplanation.answer`. A body without `turns` parses as an empty thread.
  - A pending or failed exchange is never a turn.
  - Nothing is stored: no table, no thread id, and no route beyond `POST /courses/:id/ask`. `docs/adr/0004-storage.md` is cited and not edited. A persisted thread would be derived data under its (b) and (d), decided when someone asks for one.
  - A new question starts a new thread.
- **(b) The turn-history window is a turn count, owned once.** `ASK_TURN_WINDOW` in `packages/grounding/src/turn-window.ts` owns it, with `carriedTurns(turns) → {carried, dropped}`: the newest `ASK_TURN_WINDOW` turns in order, and the count beyond them. Its restatement ledger is `.claude/ledgers/ask-turn-window.ledger`.
  - The caller (the server, the eval) applies the window once, before both the rewrite and the answer.
  - Under rule 12 it is tuned against the follow-up set's `followUpRetrieval` row ((g)), within a bound `turn-window.test.ts` asserts as an expression: `ASK_TURN_WINDOW` turns at their worst case — the embedder's input cap for the question plus `REPLY_TOKEN_RESERVE` for the answer — leave more than half of `PROMPT_TOKEN_BUDGET` to the sources.
  - This ADR sets no number; the code does.
- **(c) The carried turns enter the explanation prompt after the summaries and before the question, as context and never as a source.** `explanationRequest(question, context, turns)` (`packages/grounding/src/prompts/explanation-prompt.ts`) renders each carried turn as a `<turn>` block — `<student>…</student>` then `<tutor>…</tutor>`, a not-covered turn's tutor text the fixed string `NOT_COVERED_TURN` — inside the one user message.
  - The recording key, `requestTokens` and the prefix cache (`docs/adr/0003-model-roles-and-backends.md` § Decision (h)) are unchanged in kind.
  - The system text says what the turns are for: they say what the question refers to, and the tutor takes no fact from them and quotes no line of them.
  - The turns' tokens are part of the request's fixed cost, so `assembleContext` fits slides and summaries around them in 0009 (k)'s order, unchanged.
  - 0009 (b)'s "nothing but the raw slides and the loaded summaries enters the prompt as a source of facts" holds as written.
- **(d) A follow-up's retrieval runs on a standalone rewrite.** The rewrite is a generator-role call (0003 (a); no new role) under its own prompt: `standaloneQuestion(question, carried, generator)` in `packages/grounding/src/standalone-question.ts`, with `prompts/standalone-question-prompt.ts` (output `{question}`, name `standalone-question`).
  - It is called only when `carried` is non-empty.
  - The rewrite replaces each reference with what the turns show it refers to, keeps the student's wording otherwise, adds nothing the question does not ask, never answers it, and returns the question unchanged when it already stands alone.
  - Retrieval runs on the rewrite, spelling correction included (#393's path). Generation runs on the typed question with the carried turns ((c)). `AskReply.searched` names what retrieval ran on when that differs from the typed question; its meaning widens from "the corrected question".
  - The rewrite is never a source, never attributed and never shown as an answer.
  - **Failure policy.** `backend-failed`, `cut-off` or `invalid-output` on the rewrite is a `model-failed` reply, logged as `ask rewrite` with `modelFailureOutcome`. A rewrite the embedder refuses as over-length retrieves on the typed question instead and is logged `ask rewrite` / `over-length`: the student did not cause it, so it is not refused. A completed rewrite is logged `ask rewrite` / `rewritten`, or `kept` when it equals the typed question after whitespace normalisation. No log line carries text (`apps/server/src/server-log.ts`).
- **(e) Each turn is attributed and marked exactly as one answer is, and an earlier answer is never a source.** `searchSentence` runs once per sentence of the new answer and over nothing else. The mark's premises are the sentence's own slides. `sources` and every `slides` list hold slide ids only. The per-answer guarantees of 0009 (c) and (f)–(i) hold per turn, with no change to `mark-contradictions.ts`, `attribute-sentences.ts` or `AskReply`'s shape.
- **(f) The thread renders under the form.** The `Answer` region holds an ordered list of exchanges: the student's question, then the tutor's turn rendered by `AnswerView` as a single answer is (attribution, sources, dropped quote marks, the left-out note, not-covered).
  - The textbox clears on submit. A pending or failed exchange shows under its question, with the earlier exchanges kept.
  - A `New question` button beside `Ask`, shown only while a thread exists, clears the thread. The reader decision it serves is "continue this thread or start afresh" (`docs/standards/design.md` rule 2).
  - It is measured on desktop and at 375×812.
- **(g) The eval's follow-up set**, in `docs/adr/0005-evaluation-as-gate.md` § Decision (c) and (d)'s shape and 0010's form. 0005 is not edited.
  - `eval/follow-ups.jsonl` holds one `FollowUpItem` per line (`eval/src/follow-up.ts`): `{turns, question, standalone, expectedCitations}`, with at least one turn and one expected slide. It is hand-authored against the deck, and `standalone` is the self-contained form a student could have typed.
  - `auditEvalCourse` checks it: `unknown-citation` with the follow-up's question, and `duplicate-follow-up` on question and standalone together.
  - Two report rows, reported and never gated:

    | Metric                       | Numerator over denominator                                                                                                                                          | Tier   | Bar      |
    | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
    | Follow-up retrieval          | Of the follow-ups, those whose rewrite's top `RETRIEVAL_K` holds every expected slide the standalone form's top `RETRIEVAL_K` holds. The standalone is the ceiling. | Tier 2 | Baseline |
    | Follow-up attribution recall | `attributionRecall`'s definition (0009 (o)) over the follow-ups, asked at the light depth with their carried turns.                                                 | Tier 2 | Baseline |

  - The report keys are `followUpRetrieval`, whose failures name the follow-up, the rewrite and the missed slides, or `model-failed`; and `followUpAttributionRecall`.
  - **A follow-up is not a golden question.** 0005 (c)'s "`question` is the text asked" and 0009 (o)'s "the runner asks every golden question" stay true as written.
  - Tier 2 runs the rewrite, both retrievals and the light ask; tier 1 replays them.
  - `CLAUDE.md` § Hard constraints' bar and `.claude/ledgers/contradiction-set-bar.ledger` are unchanged: the deep contradiction set stays the only gate.
- **(h) What does not change.**
  - `AskReply`'s shape, and the deep depth.
  - 0009 (c)–(k) as they stand.
  - 0003's roles and backends. The rewrite is the generator role, and a private, scale-to-zero host is 0003 (c) and (j)'s config question, out of scope here.
  - 0004; 0005 (b) and (e)–(g); the golden questions and the contradiction set's deep gate.
  - `RETRIEVAL_K`, `ATTRIBUTION_K`, `PROMPT_TOKEN_BUDGET` and their owners.
- **(i) Revisit** when:
  - `followUpRetrieval` falls below its baseline, or the owner's own thread is one the 4B cannot hold → an issue against 0003 (c) and (j), citing this one;
  - `turns dropped` is non-zero on a real course → retune `ASK_TURN_WINDOW`;
  - someone asks for threads that survive a reload → persistence under 0004 (b);
  - `followUpAttributionRecall` falls below `attributionRecall` on the same run → #438's remedy list.
- **(j) Restatement ledger**, in the prose form `docs/standards/architecture.md` rule 9 prescribes. Owned here: the request shape (a); the window's owner and unit (b), whose value `.claude/ledgers/ask-turn-window.ledger` carries; the turn block's place and the not-a-source rule (c); the rewrite's role, inputs and failure policy (d); and the two rows (g). The sweeps, their commands and their output are in #576's plan comment. The carriers trued up in the change that lands this ADR are named in 0009 § Amendments' 2026-11-07 entry.

## Options considered

**A. Turns as chat-role `assistant` messages.** The usual shape for a conversation. Rejected: it presents the tutor's earlier words as the model's own authoritative output rather than as context named not-a-source, and it splits the request's fixed cost across messages. It is the first thing to try if the owner's check shows the model taking `<turn>` text as a source, inside (c)'s wording.

**B. No rewrite: retrieve on the typed follow-up.** Rejected: "And the drones?" finds nothing, which is the issue's second need.

**C. A fifth gateway model role for the rewrite.** Rejected: 0003 (a) has a feature name a role and never a model, every text-writing call is the generator's, and a fifth role would need its own pin, config key and eval row for one short call.

**D. Threads persisted in the course file.** Rejected for now: a schema version bump, a thread table and routes, and a server that is no longer stateless per request — and a rebuild loses derived data anyway (0004 (d)). Persistence is a later issue that changes nothing in (b)–(e).

**E. A token budget for the turns rather than a count.** It drops by size, so it needs a second drop order beside 0009 (k)'s, and a student cannot reason about it. A count is "the last few exchanges", and the token bound follows from it ((b)'s expression).

**F. Rewrite 0009 (b) and (f) in place.** Rejected: `docs/adr/README.md` § Amendments limits in-place amendments to moved or wrong values.

**G. Turns in the user message, a count window, a generator-role rewrite, session-only (chosen).** Its downsides are genuine and accepted:

- a follow-up pays one more generator call on the interactive path, before retrieval;
- the rewrite is one more place the model can be wrong, and only the eval's sample and the `ask rewrite` log line see it;
- the client sends the whole thread on every turn, though the server carries only the window.

## Consequences

**Easier.** A student asks a follow-up in their own shorthand, and it retrieves what the self-contained question would. Each turn keeps every per-answer guarantee, so nothing a student reads is less attributed than a single answer.

**Harder.** A follow-up costs one more generator call before the answer's. The eval gains a file and two rows, and a change to the rewrite prompt owes a tier-2 run. The web holds a thread, which is lost on reload. A thread whose turns pass `MAX_ASK_BYTES` is refused as a too-large body.
