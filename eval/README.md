# eval

The synthetic evaluation course: its deck, golden questions and hand labels. What each is for, and the categories the deck must hold, are `docs/adr/0005-evaluation-as-gate.md` § Decision (a)–(c)'s.

- `eval/decks/hollowmere/` — the deck, one JSON file per lecture, parsed by `DeckLecture` (`eval/src/deck.ts`). The subject is a fictional guild's beekeeping course, self-written for this repository, which deliberately teaches things a general model believes false about bees: the subject class `docs/adr/0001-grounding-architecture.md` § Context names.
- `eval/questions.jsonl` — the golden questions, one `GoldenQuestion` per line (`eval/src/golden-question.ts`, which also exports `inContradictionSet` and `firstForbiddenEntry`).
- `eval/labels/verifier.jsonl` — the verifier hand labels, one `HandLabel` per line (`eval/src/hand-label.ts`).

`auditEvalCourse` (`eval/src/audit.ts`) checks the three against each other, and `eval/src/eval-course.test.ts` runs it over the committed files under `pnpm test`.

`renderDeckPdfs` (`eval/src/render-deck.ts`) renders the deck to one PDF per lecture at test time, into a directory outside the checkout, for the ingest path: an `imageOnly` slide becomes a single image with no text layer. `eval/src/render-deck.test.ts` reads every rendering back through `@cram/ingest`'s `ingestPdf`. No rendering is tracked.

## The runner and its report

`runEval` (`eval/src/run-eval.ts`) runs the whole pipeline over a course through any `ModelGateway` and returns an `EvalReport` (`eval/src/report.ts`), the report `docs/adr/0005-evaluation-as-gate.md` § Decision (f) describes. `RecordingGateway` (`eval/src/recording-gateway.ts`) records a run's model calls in the form `FakeGateway` replays. `eval/src/run-eval.test.ts` records one run and replays it to the same report.

## The live run

`pnpm eval` is tier 2 (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)), and its entry is `eval/src/live-run.measure.test.ts`, whose header names the environment it reads. It runs `runEval` over the course as ingest makes it (`ingestedCourse`, `eval/src/ingested-course.ts`), through the backends `liveConfig` (`eval/src/live-config.ts`) configures and `openLiveGateway` (`eval/src/live-gateway.ts`) opens, and refuses a working tree that differs from `HEAD`, since the report names the commit it measured. `CRAM_MODELS_DIR` holds one snapshot per encoder pin, under the pin's `artefact.repository`.

`writeRun` (`eval/src/run-files.ts`) writes the report to `eval/reports/<short-sha>.json` and the run's recordings to `eval/recordings/<short-sha>.jsonl`. A later run keeps every older report, since those are the baselines, and replaces the recordings.
