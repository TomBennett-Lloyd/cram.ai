# 0008 — Slide chunking: a slide is indexed as one or more chunks; citations stay on the slide

- **Status:** proposed
- **Date:** 2026-10-21
- **Issue:** #339

## Context

cram.ai answers from the student's slides, and each slide is retrieved by its words (BM25) and by an embedding of its text (`docs/adr/0004-storage.md` § Decision (c)). The embedder reads a bounded number of tokens. An input longer than that is reported as `over-length` and never truncated (`packages/gateway/src/encoder-requests.ts`, #66), which is the same fail-closed rule `docs/adr/0003-model-roles-and-backends.md` § Decision (d) states for the verifier. Until now the slide was the chunk: a slide too long to embed whole could not be embedded at all (`docs/plan.md` §3.1 as it stood; #77).

The owner's first real upload, on 2026-10-21, hit that window on two references pages. #338 handles those pages and the per-slide refusal. The owner's words: "we need a way to handle slides with that much text too". Other courses' decks will carry dense content slides that this deck does not. #77 measured the owner's sample deck: no content page was near the window, while the references pages were well over it.

How much text fits is a property of the embedder, not of the deck. #339's plan comment measured the pinned embedder's own tokenizer over the eval deck: a line of figures takes several times as many tokens per character as a line of prose. So no word or character count is both safe and economical across one course.

This decision fits under three that it does not change:

- `docs/adr/0001-grounding-architecture.md` § Decision (b) makes the slide the only kind of source a citation names.
- `docs/adr/0005-evaluation-as-gate.md` § Decision (d) defines retrieval recall@k over slides.
- `docs/adr/0006-image-only-slides.md` keys confirmations to the slide's `SourceId`.

**This ADR refines `docs/adr/0004-storage.md` § Decision (b) and (c) below the slide, and changes neither.** The full-text and vector indexes still cover every record, and each list is still ranked on its own and fused by reciprocal rank fusion in the pure core. #339's plan comment holds the sentence-by-sentence check of ADRs 0001, 0003, 0004, 0005 and 0006 that found nothing this decision makes false.

## Decision

- **(a) The source stays the slide, and a slide is indexed as one or more chunks.** `SourceId` keeps its `<lectureId>/<slideNo>` shape (`sourceIdOf`, `packages/index/src/slide-row.ts`) and stays the only thing a `Citation` names. A chunk is addressed by the pair (`SourceId`, `ChunkNo`), where `ChunkNo` is a 1-based branded integer in `packages/shared/src/slide-chunk.ts`. A `SlideChunk` holds the slide's quotable fields (`slideFields`, `packages/shared/src/quotable-text.ts`). Each field keeps only the lines in that chunk, and every chunk repeats the slide's title.
- **(b) Schema: a `chunks` table under `slides`.** The full-text rows are chunks, and the vector rows are the chunks that embedded. Both virtual tables use the chunk's id as their row id. Chunk text is stored. Every slide has at least one chunk.
  - A slide stored without a vector has one whole-slide chunk with a full-text row and no vector row. That covers a `references` slide, and a slide the split cannot bring under the window. It stays listed, citable and findable by its words, and absent from the vector list (#338).
  - The table lives in `packages/index/src/chunk-row.ts`, and the schema version that orders the course file's rebuild is `SCHEMA_VERSION` in `packages/index/src/schema.ts`.
- **(c) Where the split runs.** The cut is a pure function in `packages/shared/src/split-chunk.ts`, and the embed-and-split loop is in `packages/index/src/embed-chunks.ts`. The server and eval both call the loop. The split never runs in ingest. Ingest's output is what the stored-output pin covers (#257), and a chunk is a property of the embedder, not of the deck. The loop takes a structural embed function, so `packages/index` gains no dependency on the gateway. Which slides get a vector at all (none for a `references` slide) is decided in the server's `apps/server/src/slide-embedding.ts` (#338).
- **(d) A split is triggered by the embedder's own `over-length` result, never by a fixed budget.** Every slide is first embedded whole, and only an `over-length` result splits it. A slide that fits is therefore indexed exactly as before. The budget for the pieces is derived from the density the result reports: the slide's characters × the window ÷ its measured tokens, scaled by `CHUNK_WINDOW_FILL`. A piece that is still over-length splits again. A split costs an extra embed round, never a truncation.
- **(e) The cut falls between lines, never inside one, and is by size.**
  - A line is one `\n` block of the body or the speaker notes, or one image caption, taken in `slideFields` order. The body keeps one bullet per line (`packages/ingest/src/slide-text.ts`).
  - Lines pack greedily under the budget. A line that fits no piece stands alone and is measured again. A split always yields at least two pieces, so the loop ends.
  - A single line that is still over-length is unsplittable. Its slide is then stored as (b) stores a slide without a vector, and named as unembedded (#338).
  - The owned threshold is `CHUNK_WINDOW_FILL` in `packages/shared/src/split-chunk.ts`. It is tuned against `packages/shared/src/split-chunk.test.ts`'s case "leaves room in every piece for text a third denser than its parent".
  - A heading preference is deferred, by owner decision 2026-10-21 (#339's Q1). No reader emits a mid-slide heading as a line of its own yet: the PDF reader glues an unmarked line after a bullet onto that bullet (`docs/tech-debt.md`, 2026-10-19), and the PPTX reader emits no markers. The preference joins once a slide line carries its indent.
- **(f) Retrieval deduplicates each ranked list to slides before fusion, and fusion and k count slides.** In each list, a slide's best chunk gives its rank, and the slide's later chunks are dropped. The two slide lists are then fused as `docs/adr/0004-storage.md` § Decision (c) states. `RETRIEVAL_K` keeps meaning a number of slides, so `docs/adr/0005-evaluation-as-gate.md` § Decision (d)'s recall@k is unchanged. `CANDIDATES_PER_LIST` becomes the number of chunks read per list. Both live in `packages/index/src/course-index.ts`.
- **(g) Generation and resolution are untouched.** A retrieved slide carries the whole slide. The generator sees the whole slide's text, quotes resolve against the whole slide, and the student is shown the slide, never a chunk.
- **(h) The schema version moves.** `SCHEMA_VERSION` goes up by one in the change that adds the `chunks` table. A course file written before it rebuilds from its stored decks under `docs/adr/0004-storage.md` § Decision (d). The stored-output pins are recorded again, and their digests do not move: neither ingest's output nor the quotable fields change.
- **(i) Re-embedding re-chunks.** A course re-embedded under another embedder starts again from whole slides through the same loop. A smaller window then gives more chunks and a larger one fewer.
- **(j) Restatement ledger.** The rule in (a), (d) and (e) — a slide is indexed as one or more chunks, cut between lines only when the embedder reports it over-length — is declared at `.claude/ledgers/slide-chunking.ledger`, whose owner is `packages/shared/src/split-chunk.ts`. That ledger's sweep finds its carriers, and `check:ledgers` re-runs it on every `pnpm verify`. This file is one of its carriers.

## Options considered

**A. Chunks below the slide, split on the embedder's report, deduplicated to slides per list (chosen).** Its downsides are genuine and accepted:

- The course file stores each slide's text twice: once on the slide and once across its chunks.
- A long slide costs an extra embed round at ingest, and two rounds when a piece is still too dense.
- A retrieved long slide puts its whole text in the generator's prompt, and slide length is already one of retrieval's latency parameters (`docs/adr/0003-model-roles-and-backends.md` § Decision (h)).
- A single line too long for the window still cannot be embedded, so its slide is findable by its words only.
- The index's queries go through one more table.

**B. A chunk-level `SourceId` (`<lectureId>/<slideNo>#<n>`) that citations name and resolution maps back.** Rejected: it would change `Citation`, the reply's cited slides, the contradiction set's expected citations and every screen that shows a citation, for no gain the student can see, and it would make a chunk a source in breach of `docs/adr/0001-grounding-architecture.md` § Decision (b).

**C. A fixed word or character budget per chunk.** Rejected: one course's lines differ by several times in tokens per character, so a budget safe for figures wastes most of the window on prose. It would also split slides that fit whole, which moves the recall baseline for no reason.

**D. A token-counting capability on the gateway.** Rejected: it adds a capability to `docs/adr/0003-model-roles-and-backends.md` § Decision (b) to learn what the embedder's `over-length` result already reports.

**E. Fuse chunk ids, then collapse to slides; or sum fusion scores across a slide's chunks.** Rejected: collapsing after fusion lets one slide with several matching chunks push other slides down the fused list, and summing rewards a slide for being long.

**F. Split in ingest, as several slide records per slide.** Rejected: the records are what the stored-output pin covers and what every slide-keyed table names, and where to cut depends on the embedder, which ingest does not know.

## Consequences

**Easier.** A dense content slide is indexed by its words and by its meaning, and the deck reports `indexed`. Citations, confirmations, topics, recall@k and every screen keep naming slides. Changing the embedder changes the chunks and nothing else.

**Harder.** The index has a level below the slide that its queries must collapse. Every slide's text is stored twice, and a long slide makes a slower ingest. A heading-aware cut waits for a reader that keeps a slide line's indent.

**Explicitly accepted.** A line longer than the embedder's window is found by its words only. The generator reads the whole slide even when one chunk matched.

**What would make us revisit.** A reader that emits mid-slide headings (the deferral in (e)); a retrieval measurement showing that chunk-level ranking beats the per-slide dedupe in (f); or an embedder whose window is too small for single slide lines in real decks.
