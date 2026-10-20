# cram.ai — project plan

- **Date:** 2026-10-13
- **Status:** accepted by the owner in chat on 2026-10-13 (name, licence, exam realism, single-user scope, Windows installer); §9 q1 was answered on #3 and the model choice is `docs/adr/0003-model-roles-and-backends.md`'s.
- **Lifetime:** this document seeds the first ADRs and the milestone issues. A section that an ADR supersedes is replaced by a pointer to that ADR; the milestones become issues and this file stops tracking them.

## 0. The one-paragraph version

Do **not** fine-tune a model per user. Fine-tuning teaches a model how to _sound_, not what is _true_, and it does not suppress what the base model already believes; a model fine-tuned on slides produces fluent slide-flavoured text with no way to tell a remembered fact from an invented one. Instead the slides go into a **search database that is the only source the model is ever allowed to speak from**, every sentence the tutor emits carries a citation to a specific slide, and a second **verifier** pass strips any sentence the cited slide does not support. "The slides take precedence over the base model" then stops being a prompt-engineering hope and becomes a mechanical property: a sentence that only the base model believes has no supporting slide, so it is deleted before the student sees it. That same mechanism also deletes any unsolicited "however, mainstream medicine says…" caveat, because that sentence is unsupported by the slides too. The whole thing runs on an open-weight model on the student's own Windows laptop, installed from a normal installer, and the identical code deploys to a private self-hosted server if that is ever needed. The code is public; no slide content, user data, or deployment address ever enters the repo.

## 1. Why not per-user fine-tuning

Superseded by `docs/adr/0001-grounding-architecture.md` — § Options considered carries the comparison and § Decision (g) the style-LoRA deferral; this section carries no restatement.

## 2. Hard constraints

Owned by `CLAUDE.md` § Hard constraints; this section carries no restatement.

## 3. Architecture

Owned by `docs/adr/0002-deployables.md` (the deployable count, the model runtime's place outside it, and the bar for a second deployable); this paragraph carries no restatement.

```
 upload ─▶ ingest ─▶ index (SQLite per course) ◀─ retrieve ◀─ tutor features ◀─ web UI
                                                       │
                                            model gateway (one interface)
                                                       │
        encoders in-process (every mode)  |  generator: node-llama-cpp (installed app) or HTTP (dev, private host)
```

### 3.1 Ingest

- Inputs: PDF and PPTX lecture decks; a text/PDF file of sample exam questions (and, ideally, a full sample paper so the exam _format_ can be mirrored — see §3.5).
- Output: one **slide record** per slide, shaped by `SlideRecord` (`packages/shared/src/slide-record.ts`). The slide is the chunk. `body` holds one bullet or line per `\n` (`slideText`, `packages/ingest/src/slide-text.ts`), so a later split cuts between lines, never mid-bullet. Splitting a slide by heading waits for a content slide too long to embed whole, which the embedder reports as `over-length` (#66); the owner's sample deck has none (#77).
- Image-only slides are owned by `docs/adr/0006-image-only-slides.md` (what triggers derivation, the `derived` flag, OCR as an ingest adapter, opt-in captions, who may cite derived text and with what shown beside it, the confirmation state and the derived-text metric); this bullet carries no restatement.
- Sample exam questions are parsed into **style exemplars**: `{type: mcq | short | essay | case, stem, options?, marks?, sectionOf?}`. They are never used as a source of facts.

### 3.2 Index

- Owned by `docs/adr/0004-storage.md` (the one-file-per-course unit, what lives in it, the retrieval substrate and its fusion, deletability and portability, the no-migration rule with its un-defer trigger, the encryption deferral, and the bar for a second store); this bullet carries no restatement. After fusion, a local cross-encoder rerank when the candidate list is large is retrieval's (#11), with the model `docs/adr/0003-model-roles-and-backends.md`'s.
- Embeddings go through the model gateway, so every backend serves them the same way.
- **Topic index**: at ingest, an LLM pass tags each slide with topics; tags are user-editable. "Revision notes for _category_" resolves category → the union of tagged slides plus semantic neighbours, across all lectures. The tag pass is the one place an LLM writes into the index, and its output is metadata, never content.

### 3.3 Model gateway

Owned by `docs/adr/0003-model-roles-and-backends.md` (the roles and their independent configuration, the gateway's capabilities, the backend per role and run mode, the verifier and the measurement that settles it, where role config lives, the pin shape, the candidates and their licences, and the interactive/background split the selection rests on); this section carries no restatement.

### 3.4 Grounding contract (the core of the project)

Owned by `docs/standards/grounding.md` (the rule) and `docs/adr/0001-grounding-architecture.md` (the decision and the verifier contract); this section carries no restatement.

### 3.5 Features on top of the contract

**Ask a question.** Retrieve → generate units → verify → render with slide thumbnails beside each citation. No supported unit → "Your slides don't cover this. Closest slides: …".

**Revision notes by category.** Resolve category via the topic index → retrieve every member slide across lectures → generate an outline whose every bullet is a unit → verify → render grouped by sub-topic with a "sources" footer listing every lecture/slide drawn on. Statements synthesise across lectures and every claim is anchored by verbatim quotes (`docs/standards/grounding.md` rule 9).

**Practice exam — realistic from the start (owner decision 2026-10-13).** Chunk-first, not topic-first: the generator never writes a question from a topic name. Flow: pick target slides (by category, or weighted across the course the way the sample paper weights its sections) → for each, generate `{question, goldAnswer, rubric[], marks, citations}` in the style of a sampled exemplar of the requested type → verify the gold answer _and each rubric point_ under `docs/standards/grounding.md` rule 4 → drop any question whose gold answer or rubric fails. Questions therefore cannot ask for anything the slides do not contain, by construction, and the gold answer is stored with the question before the student sees it. Realism means: a **paper**, not a question list — sections and marks mirroring the sample paper's structure, a timer with the paper's duration, one-question-at-a-time or whole-paper navigation, flag-for-review, no answers visible until submission, then a marked script with per-question marks, the rubric verdicts, the source slides, and a history of attempts with scores over time.

**Free-text grading.** Grading assesses meaning, so it is a judgement, not a fact, and an LLM judge is the right tool — but it judges against a **rubric whose every point is already a verified unit**. For each rubric point: "Does the student's answer express this point? `yes | partial | no` + the phrase that does." Score = points met / points total, weighted by marks. The student sees each rubric point, the verdict, and the source slide, so a disputed mark is self-checkable. Embedding similarity between answer and gold is logged as a sanity signal, never as the score.

### 3.6 UI and packaging

- Single-page app, same stack family as cumulo (React + TypeScript, design tokens, stylelint/eslint gates). Screens: courses, upload/ingest status, slide browser with topic tags, ask, notes, exam (sit / review / history), settings (model, data folder).
- **Desktop app for a non-technical Windows user (owner decision 2026-10-13).** An Electron shell runs the Node server in its main process and loads the SPA; `node-llama-cpp` runs the model in-process; an NSIS installer is produced by `electron-builder` on a GitHub Actions Windows runner. First launch downloads the model files from Hugging Face with checksum verification into the app's data folder (the only outbound connection the app ever makes, and it carries no user data); everything after that is offline. Code signing is deferred: an unsigned installer shows a SmartScreen warning the user clicks through, and a signing certificate is a cost decision for the owner (§9).
- Developer mode is the same server started with `pnpm dev` against Ollama. Electron is chosen over Tauri because the server is already Node and `node-llama-cpp` is a Node binding; one runtime, one installer.

## 4. Evaluation is a gate, not a dashboard

Owned by `docs/adr/0005-evaluation-as-gate.md` (the eval course, the contradiction set, the golden-question schema, the metrics and their bars, the two tiers, the report and the `check:eval-report` gate's shape); this section carries no restatement.

## 5. Repo layout

```
apps/
  server/       Node: upload, ingest, index, tutor endpoints; serves web in local mode
  web/          React SPA
  desktop/      Electron shell + electron-builder config (Windows installer)
packages/
  shared/       zod schemas: SlideRecord, Unit, Citation, ExamPaper, ExamQuestion, Rubric, StyleExemplar
  ingest/       pdf/pptx → SlideRecord; OCR adapter
  index/        SQLite schema, FTS5 + sqlite-vec, hybrid retrieval, topic index
  gateway/      model gateway interface, role config, in-process and OpenAI-compatible adapters
  grounding/    units, citation resolution, verifier, prompts (the contract, pure core)
  tutor/        ask / notes / exam / grade, composed from grounding
eval/           synthetic deck, golden questions, eval runner
docs/           standards, adr, logs, this plan
.claude/        agents, skills, hooks, scripts, workflow.json (ported from cumulo)
```

Pure core, effectful edges (`docs/standards/architecture.md`): `grounding` and `tutor` are functions of typed inputs plus a `ModelGateway` interface, so the whole contract is unit-testable with a fake gateway.

## 6. Workflow

Ported from cumulo at its current graduated state in the bootstrap commits; `CLAUDE.md` § Workflow and `.claude/workflow.json` own it. Project-specific gate to add by ticket: `check:eval-report`. The AWS, Terraform and OIDC gates were not ported.

## 7. ADRs to write first (each is an issue with the `adr` label)

1. **0001 Grounding architecture** — retrieval + citation + verification, not fine-tuning; the unit contract; and `docs/standards/grounding.md`. Written — `docs/adr/0001-grounding-architecture.md` (#1); §1 and §3.4 above now point at it.
2. **0002 Deployables** — one app (server + web + desktop shell) plus a bundled model runtime; local-first; private-network server only when needed; the bar for a second deployable. Written — `docs/adr/0002-deployables.md` (#2); §3's lead paragraph above now points at it.
3. **0003 Model roles and backends** — generator / verifier / embedder / reranker; backends by role and run mode; the candidates, their licences and the measurement that pins them; the verifier's shape. Written — `docs/adr/0003-model-roles-and-backends.md` (#3); §3.3 above now points at it.
4. **0004 Storage** — one SQLite file per course; FTS5 + sqlite-vec; no shared store; at-rest encryption deferred with the trigger that un-defers it. Written — `docs/adr/0004-storage.md` (#4); §3.2's first bullet above now points at it.
5. **0005 Evaluation as a merge gate** — the synthetic deck, the contradiction set, the two tiers, the 100% metrics. Written — `docs/adr/0005-evaluation-as-gate.md` (#5); §4 above now points at it.
6. **0006 Image-only slides** — OCR + caption with the `derived` flag; what the UI must show; who may cite derived text. Written — `docs/adr/0006-image-only-slides.md` (#6); §3.1's image-only bullet above now points at it.
7. **0007 Desktop packaging** — Electron + node-llama-cpp + NSIS; model download on first launch; signing deferred.

## 8. Milestones → issues

- **M0 Bootstrap**: tooling baseline, ported `.claude/`, docs skeleton, CI, this plan, ADR 0001–0002. Human-reviewed.
- **M1 Ingest + index + ask**: PDF/PPTX → SlideRecord; SQLite index; hybrid retrieval; gateway with the HTTP (Ollama) adapter; the grounding contract; Ask end-to-end in the browser with citations. Ships with the synthetic deck and the first golden questions.
- **M2 Eval harness as gate**: contradiction set, recorded-output fixtures, `pnpm eval`, `check:eval-report`. Before notes and exams on purpose: every later feature lands with its metric.
- **M3 Revision notes by category**: topic index at ingest, editable tags, notes generation, cross-lecture sources footer.
- **M4 Exams + grading**: exemplar and sample-paper parsing, chunk-first generation, rubric verification, the exam-sitting UI (paper, timer, navigation, submission, marked script, history), rubric-based grading with per-point evidence, background generation pool.
- **M5 Windows desktop app**: `node-llama-cpp` backend, Electron shell, model download with checksums, NSIS installer from CI, OCR for image slides (ADR 0006), first dry run on the real user's machine with findings as issues.
- **M6 Self-hosted multi-user** — _when needed_ (owner decision 2026-10-13): docker-compose for server + vLLM, local accounts, per-user data directories, private-network binding, backup/delete runbook. Not scheduled.

## 9. Open questions for the owner

1. **The target Windows machine**: answered by the owner on #3 (2026-10-13); the sizing it decides is `docs/adr/0003-model-roles-and-backends.md`'s.
2. **A sample deck** (not committed) to size the image-only-slide problem on during M1: answered by #9's sizing comment (2026-10-13); what it decided is `docs/adr/0006-image-only-slides.md`'s.
3. **Windows testing**: development is on a Mac. CI can build the installer on a Windows runner, but someone has to run it. Options: a Windows VM on the Mac, or the first user's machine as the smoke test with a short checklist.
4. **Code signing**: pay for a certificate (removes the SmartScreen warning) or accept the warning for a single known user.
5. **Licence**: "same as cumulo" was the decision — and cumulo has **no licence file**, which makes it public source with all rights reserved rather than open source. This repo mirrors that for now; adding a licence file is its own decision.

## 10. Bootstrap record

1. Repo created at `~/Documents/Repos/cram.ai`, GitHub `TomBennett-Lloyd/cram.ai` (public), default branch `main`.
2. Three bootstrap commits mirroring cumulo's: tooling baseline; agentic workflow; docs and this plan.
3. Issues opened for ADR 0001–0002 and the M1 tickets.
