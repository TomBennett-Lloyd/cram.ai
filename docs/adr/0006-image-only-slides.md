# 0006 — Image-only slides: OCR and captions as derived text, flagged and shown with the original

- **Status:** accepted
- **Date:** 2026-10-20
- **Issue:** #6

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into cited answers, revision notes and practice exams. Every citation quotes a slide's text, so a slide whose text exists only in a picture cannot be cited unless something reads the picture. This ADR decides what reads it, what the result counts as, and who may cite it.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. It answers three of those bullets:

- the one headed "Nothing the tutor says is uncited", because text read out of an image is the only text a citation can quote that the course's author never typed;
- the one on course content leaving the machine, which places OCR beside the other models;
- the one on open-weight, permissively licensed models, which bounds the candidates in (d) and (e).

`docs/adr/0001-grounding-architecture.md` § Options considered 3 states what is at stake and hands it here: a quote from recognised text passes the substring check against whatever the recognition produced, right or wrong.

The problem was sized on the owner's own sample deck, read locally and never committed. #9's sizing comment of 2026-10-13 records it, and this ADR records only its counts:

- 88 pages;
- 0 pages under #9's sizing probe for a thin text layer;
- 1 page where images cover most of the page, and even its labels are in the text layer;
- 178 distinct images, of which 2 recur on most pages as decoration;
- 85 pages carrying a non-recurring illustrative picture that takes up a small part of the page (5–20% of its area) and carries no examinable text.

The owner drew the direction on #6: OCR is a correctness path for the rare page, not a throughput path, and small illustrative pictures are ignored by default, with captioning opt-in per slide. These counts are the premise the decision was sized against. A deck where thin pages are common is the revisit trigger in § Consequences.

OCR quality could not be measured on that deck. No OCR tool is installed on the development machine, and the deck has no image-only page to read. A5 in (i) records the gap, and (h) is where the number comes from.

What exists:

- `packages/shared/src/slide-record.ts`'s `SlideRecord`, with one `derived` boolean per record (#8). Its column is in `packages/index` (#11).
- `@cram/ingest`'s `slideText` (`packages/ingest/src/slide-text.ts`, #9), which classifies a page whose text layer is under `THIN_TEXT_LAYER_WORDS` as the `image-only` `SlideKind`, gives it an empty `body` and does not OCR it. `SlideKind` is a `SlideRecord` field (`packages/shared/src/slide-record.ts`, #78), and #10's PPTX adapter reaches the same classification through `slidesFromPages` (`packages/ingest/src/deck.ts`).
- The course file's `slide_images` table (`packages/index/src/stored-deck.ts`, #70), which holds one `SlideImage` per slide. Nothing renders one yet.
- The eval deck's `imageOnly` slides (`eval/src/deck.ts`, #14), whose true text the source keeps. `docs/adr/0005-evaluation-as-gate.md` § Decision (a) and (h) leave the metric over them to this ADR.

## Decision

- **(a) What triggers derivation is the text layer, never the image.** A page is derived when `slideText` classifies it `image-only`. That happens when its text layer, after page numbers are stripped, is empty or under `THIN_TEXT_LAYER_WORDS`. That constant is the one owner of the threshold. It is a tuned input in the sense of `docs/standards/architecture.md` rule 12, re-tuned against the eval deck's `imageOnly` slides when the OCR adapter lands (#108), and this ADR carries no value for it. #9's sizing probe was a probe, not the threshold. An image's presence, count or area never triggers derivation, and there is no second threshold.
- **(b) Derived text is source text, flagged at the record.** It enters the pipeline on the source side, as a `SlideRecord` with `derived: true`. It is never a unit and never the tutor's voice. `docs/adr/0001-grounding-architecture.md` § Decision (b)'s closed list governs what the tutor says. Derived text is a transcription of the course, shown as the slide's text beside the slide's image, so that list is untouched.
  - The flag is per record. A record is derived if any of its text came from OCR or a caption, and the consequence is accepted: one opted-in caption on a full-text slide makes the whole record derived.
  - An `image-only` page's `body` is the OCR output in full. The thin native layer is discarded, because by (a)'s definition it is noise.
  - With no OCR engine configured, or when the engine fails on a page, the record stays as #9 emits it: an empty `body`, `derived: false`. That is a slide with no text, which the ingest status reports (#15). It is never an error.
  - The verifier judges a derived quote as text, under `docs/adr/0001-grounding-architecture.md` § Decision (d) unchanged. The image is for the student, not the model.
- **(c) OCR is an ingest adapter, not a gateway role.** It runs in `packages/ingest` (`docs/plan.md` §5's `ingest/` row), at ingest time only. It is not a language model and is never served at query time, and `docs/adr/0003-model-roles-and-backends.md` § Decision (a)'s roles are what the gateway serves.
  - **Its input** is the stored rendering. Each page is rendered once to a `SlideImage` at ingest (#107) and stored in the course file (`docs/adr/0004-storage.md` § Decision (b)), and OCR reads that stored image. So the image shown beside a citation is the image the text was read from.
  - **Its pin** is in `docs/adr/0003-model-roles-and-backends.md` § Decision (e)'s shape and is held in `packages/ingest`'s config. (Annotated 2026-10-20, #124: since that ADR's amendment of that date, (e)'s shape differs by artefact, and an OCR pin takes the encoder form: a `manifest` holding the sha256 of each file the engine loads, with its `sha256` taken over that manifest, because neither candidate in (d) is one self-contained file. See § Amendments.) The eval report records it beside the role pins. A changed pin re-derives the text by rebuilding from the stored decks, the path `docs/adr/0004-storage.md` § Decision (d) already gives.
  - **No confidence threshold in v1.** The engine's output is kept whole. If (h) shows a need for one, it is a tuned input in `packages/ingest`, not a value here.
  - **A citation to a derived record carries nothing extra.** `Citation` (`packages/shared/src/citation.ts`) is unchanged. Whether its source is derived is read from the record, both when the citation is resolved and when it is rendered.
- **(d) OCR engine candidates, with their licences.** A candidate is admitted under `docs/adr/0003-model-roles-and-backends.md` § Decision (g)'s rule: an OSI-style permissive licence, with the candidate's own licence deciding. The provisional default is the first admitted row. Measurement under (h) decides between them, and changing the pin is a code change in `packages/ingest` argued by an eval report, not an amendment to this ADR. Licences were read on 2026-10-20 (A6).

  | Candidate                                                                                                      | Licence                 | Admission and caveats                                                                                                                                                                                                                    |
  | -------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `tesseract.js` 7.0.0, with `tesseract.js-core` 6.1.2 (WebAssembly) and `tessdata`                              | Apache-2.0 / Apache-2.0 | admitted; provisional default. It fetches its worker, core and language data from a CDN unless pointed at local paths (A2), so `check:no-network-egress` flags it, and its allow-list entry is the owner's decision on #108              |
  | PP-OCRv5 (`PaddlePaddle/PP-OCRv5_mobile_det`, `PaddlePaddle/PP-OCRv5_mobile_rec`) on `onnxruntime-node` 1.30.0 | apache-2.0 / MIT        | admitted; it reuses the runtime `docs/adr/0003-model-roles-and-backends.md` § Decision (c) already brings, and needs detection and recognition pre- and post-processing, for which `@gutenye/ocr-node` 1.4.9 (MIT) is the candidate (A3) |
  | `microsoft/Florence-2-base` (ONNX export `onnx-community/Florence-2-base`) under its OCR task                  | mit / mit               | admitted with a caveat: a vision-language model, so its OCR is generated text that can contain words the image does not; measured, never the default                                                                                     |
  | a system `tesseract` binary, or any cloud OCR API                                                              | —                       | not admitted: the installed app cannot depend on a system binary, and a cloud API breaks the first hard constraint                                                                                                                       |

- **(e) Captioning is opt-in per slide, and the captioner is named but not adopted.**
  - The opt-in is a per-slide action in the slide browser that derives text from that slide's images. In v1 it runs (d)'s OCR engine over them, which covers the image-dominant page the sizing found. The output goes into `imageCaptions` and makes the record derived.
  - A captioner is a vision model with its own pin. That makes it a gateway role in `docs/adr/0003-model-roles-and-backends.md`'s sense, like the reranker. Adding one changes that ADR's role set, so it is a successor to ADR 0003 to write, not this one. No captioner ships in v1.
  - The candidates such a successor would start from (licences read on 2026-10-20, A6): `HuggingFaceTB/SmolVLM-256M-Instruct` and `HuggingFaceTB/SmolVLM-500M-Instruct` (apache-2.0), `vikhyatk/moondream2` (apache-2.0), `ibm-granite/granite-vision-3.2-2b` (apache-2.0), `Qwen/Qwen3-VL-2B-Instruct` and `Qwen/Qwen3-VL-4B-Instruct` (apache-2.0), and `microsoft/Florence-2-base` (mit). Not admitted: `Qwen/Qwen2.5-VL-3B-Instruct`, whose card names no permissive licence, and `google/gemma-3-4b-it`, under Gemma terms as in ADR 0003 § Decision (g).
  - The trigger that un-defers the captioner, in `docs/adr/0004-storage.md` § Decision (g)'s shape: a real deck on which the student opts in a slide whose examinable content exists only in a picture with no text in it. The owner's deck has none.
  - A caption, when one exists, is the weakest kind of source: a model's description of a picture, never a statement of the course. It is gated exactly as OCR text is.
- **(f) Who may cite derived text.**
  - **Ask and notes** cite it, confirmed or not. The UI shows the original slide image beside the citation, as the full stored rendering and not only the thumbnail `docs/plan.md` §3.5 gives every citation, and labels the quote as derived.
  - **The slide browser** labels a derived record, shows it beside its image, and offers a confirm control.
  - **Exam generation** (questions, gold answers, rubric points) leaves every unconfirmed derived record out of its retrieved set. A citation to one then fails the "in the retrieved set" check of `docs/adr/0001-grounding-architecture.md` § Decision (c), mechanically. No verifier rule and no withheld reason is added. Where the filter lives is #109's to decide.
  - **Topic tagging** reads derived text, because a tag is metadata (`docs/adr/0001-grounding-architecture.md` § Decision (b)).
  - **Nothing refuses** a citation to derived text. Hiding a slide the student uploaded is worse than showing it beside the image it was read from.
- **(g) Confirmation state lives in the course file, and its schema is `packages/index`'s.**
  - It is stored per slide, keyed by `SourceId` (`sourceIdOf`, `packages/index/src/slide-row.ts`). It records the hash of the derived text that was confirmed and when.
  - A confirmation is void once the record's derived text no longer has that hash, for example after a re-derivation under a new pin.
  - It is not a `SlideRecord` field. Ingest emits records, and confirming is the student's act, on the same footing as topic tags (`docs/adr/0004-storage.md` § Decision (b)). Only the student confirms, never a model.
  - Confirmations are derived data under `docs/adr/0004-storage.md` § Decision (d): a rebuild loses them, as it loses tags, attempts and notes.
  - Correcting derived text, as opposed to confirming it, is out of this ADR's scope (#111).
- **(h) The derived-text metric**, answering `docs/adr/0005-evaluation-as-gate.md` § Decision (a) and (h). It is computed over the eval deck's `imageOnly` slides, in that ADR's § Decision (d) numerator-over-denominator shape. It is measured at tier 2 (`pnpm eval`), because it needs the OCR engine and a rendering the runner makes at run time (#79). Nothing binary is tracked, and the contract stays over `SlideRecord`.

  | Metric                 | Numerator over denominator                                                                       | Bar                                                                                                      |
  | ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
  | Derived-text coverage  | Of those slides, those whose record is `derived: true`.                                          | 100%, owned here: a miss is the trigger or the adapter failing, a wiring fault, never a model regression |
  | Derived-text recall    | Of the true text's tokens, pooled over those slides, those present in the record's derived text. | Baseline (`docs/adr/0005-evaluation-as-gate.md` § Decision (f))                                          |
  | Derived-text precision | Of the derived text's tokens, pooled over those slides, those present in the true text.          | Baseline                                                                                                 |

  Tokens are whitespace-split after lower-casing and stripping punctuation, by one function in `eval/`, defined once. The report gains the OCR pin, these rows, and the per-slide failures for coverage. The metric is first measured when the OCR adapter lands (#108, after #47's runner), and that run is its baseline. Until then the eval deck's `imageOnly` slides are unexercised.

- **(i) Assumptions.** Each is checked before anything is built on it, and the ticket named in (j) records the result.
  - Assumption: A1 — `tesseract.js` 7.0.0 is Apache-2.0 and ships no native addon. Check: `npm view tesseract.js@7.0.0 license`, then `npm pack tesseract.js@7.0.0 && tar -tzf tesseract.js-7.0.0.tgz | command grep -E 'binding\.gyp|\.node$'` returns nothing.
  - Assumption: A2 — `tesseract.js` fetches its worker, core and language data remotely by default and accepts local `workerPath`, `corePath` and `langPath`. Check: `tar -xzf tesseract.js-7.0.0.tgz && command grep -rnE 'https?://' package/src` shows the defaults, and `command grep -rnE 'langPath|corePath|workerPath' package/src` shows the options.
  - Assumption: A3 — `@gutenye/ocr-node` 1.4.9 bundles the PP-OCRv5 ONNX models and downloads nothing at run time. Check: `npm pack @gutenye/ocr-node@1.4.9 && tar -tzf gutenye-ocr-node-1.4.9.tgz | command grep -E '\.onnx$'` lists the models, and `command grep -rnE 'https?://' package/dist` is empty.
  - Assumption: A4 — `onnx-community/Florence-2-base` loads on `onnxruntime-node` within the memory `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A3 leaves free, since OCR runs at ingest while no generator need be loaded. Check: `curl -s "https://huggingface.co/api/models/onnx-community/Florence-2-base?blobs=true" | jq '.siblings[] | select(.rfilename|endswith(".onnx")) | [.rfilename, .size]'`, then a load on the development machine.
  - Assumption: A5 — OCR of rendered slide text is good enough that a derived quote survives the student's check against the image. Unmeasured, as § Context says. Check: (h)'s first run, recall and precision read per slide.
  - Assumption: A6 — every licence in (d) and (e) is as read on 2026-10-20. Check: `curl -s https://huggingface.co/api/models/<repo> | jq -r .cardData.license` and `npm view <package> license`, then each repository's licence file.
  - Assumption: A7 — a PDF page renders to an image in Node without a browser, through `unpdf`'s `renderPageAsImage`, which `packages/ingest` already depends on (#9), with `@napi-rs/canvas` 1.0.11 (MIT), a native addon that `check:no-network-egress` flags. Check: `command grep -n 'renderPageAsImage' node_modules/.pnpm/unpdf@1.9.0/node_modules/unpdf/dist/index.d.mts`, then a one-page render in #107.
  - Assumption: A8 — no pure-Node PPTX page renderer exists, so for #10's picture-only slides both the OCR input and the original shown beside a derived citation are the slide's embedded picture, not a page rendering. Check: #107 reads the picture-only slide's pictures from the deck's `ppt/media/` members, which #10's adapter never inflates (`packages/ingest/src/adapters/pptx/ingest-pptx.ts`), and searches for a renderer.
- **(j) What each ticket delivers.** This ADR delivers the decision.
  - #9 delivered (a)'s classification, its threshold constant, and the record shape (b) starts from.
  - #10 delivered the same classification over PPTX slides, through `slidesFromPages`.
  - #107 delivers the page rendering stored per slide, with its egress decision.
  - #108 delivers the OCR adapter: the dependency and its allow-list entry, which are the owner's to grant there; the pin; the per-slide opt-in; and the producer of (h)'s inputs.
  - #109 delivers the confirmation state and the exam-path exclusion.
  - #113, after #16's thumbnails, delivers the derived label, the full image beside a derived citation and the slide browser's confirm control and opt-in, with acceptance measured in a browser.
  - #47 and #79 deliver (h)'s report rows and the run-time rendering of the eval deck.
  - #112, a successor to ADR 0003, delivers the captioner role when (e)'s trigger fires.
  - #110 decides whether `check:eval-report`'s trigger set covers the OCR path.
- **(k) Restatement ledger**, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes, following `docs/adr/0004-storage.md` § Decision (h)'s precedent. Owned here: the text-layer trigger rule in (a) (its threshold value is `THIN_TEXT_LAYER_WORDS`'s), the per-record flag in (b), the image-beside-citation rule and the exam exclusion in (f), the confirmation state's placement in (g), the coverage bar and the metric definitions in (h). The rule-10 form of the exclusion is `docs/standards/grounding.md` rule 10. Sweep: `git grep -n -iE '0006-image-only|ADR 0006|(^|[^0-9a-z])#6([^0-9]|$)|(^|[^a-z])ocr([^a-z]|$)|caption|derived text|derived-only|image-only|image only|imageOnly|thin text|text layer|slide browser' -- ':/' ':/!pnpm-lock.yaml' ':/!docs/adr/0006-image-only-slides.md'`, whose first arm is the citation arm. The `(^|[^0-9a-z])#6` arm stands in for `\b`, which macOS `git grep -E` does not support (#40). Run with this change in the working tree, rebased onto `4684fe1`, on 2026-10-20 for branch `6-adr-image-only-slides`. Its hits, by file:

  - Carriers trued in this change: `docs/plan.md` §3.1, whose image-only bullet becomes a pointer here; §7 item 6, marked written; §9 q2, marked answered. §3.1's record-shape bullet, which already cites `packages/shared/src/slide-record.ts` (#78), is left standing.
  - Cites by path: `docs/standards/grounding.md` rule 10, added in this change.
  - Index row: `docs/adr/README.md` § Index (this ADR's row).
  - Immutable ADRs deferring here by number, left standing: `docs/adr/0001-grounding-architecture.md` § Options considered 3; `docs/adr/0002-deployables.md` § Decision (g), OCR as a module and not a deployable; `docs/adr/0004-storage.md` § Decision (b), renderings stored so a derived citation can show the original; `docs/adr/0005-evaluation-as-gate.md` § Decision (a) and (h), the metric this ADR defines.
  - Code carriers citing by number, consistent and left standing: `packages/shared/src/slide-record.ts`'s `derived` docblock; `packages/shared/src/deck.ts`'s `SlideImage` docblock; `packages/shared/src/slide-record.ts`'s `SlideKind` and its `image-only` docblock sentence; `packages/ingest/src/slide-text.ts` and its tests, the `image-only` classification; `packages/ingest/src/adapters/pptx/deck-fixture.ts`'s fixture docblock; `eval/src/deck.ts`'s `imageOnly` docblock and the eval deck's `imageOnly` slides under `eval/decks/`; `eval/src/render-deck.ts` and `eval/README.md`, which render an `imageOnly` slide as a single image (#79), the input (h) reads; `packages/grounding/src/slide-text.ts`, which makes `imageCaptions` part of the text a quote resolves against (#13), as (b) and (e) require.
  - Mechanical carriers of the field, no claim: `packages/index/src/` (the `image_captions` column, the slide row and fixtures), `packages/ingest/src/deck.ts`'s and `packages/grounding/src/fake-gateway-fixture.ts`'s empty `imageCaptions`, and their tests.
  - Left standing, consistent: `docs/plan.md` §3.5's thumbnails sentence, §3.6's screens list, §5's `ingest/` row and §8 M5's scope line; `docs/adr/0004-storage.md` § Decision (d)'s derived-data list, which (g) says confirmations join, not edited because 0004 is immutable.
  - Past-tense records: `docs/review-feedback.md`'s entries naming #6.
  - Non-carriers, the words in another sense: `CLAUDE.md` § Hard constraints, which names OCR among what runs locally (the constraint (c) argues from); `docs/design/design-principles.md`, whose hit is the "text layer" inside "context layers"; `packages/ingest/src/page-text.ts`, whose hit is "text layer" in a docblock on page lines.

## Options considered

**A. The text layer triggers, the flag is per record, OCR is a pinned ingest adapter, captions are opt-in with the captioner deferred, citations show the image, and exams exclude unconfirmed records from retrieval (chosen).** Its downsides are genuine and accepted:

- One opted-in caption makes a whole record derived and keeps a full-text slide out of exams until it is confirmed.
- OCR quality is unmeasured until (h)'s first run (A5).
- A second family of model files, OCR's, has to be pinned and shipped (ADR 0007, #7).
- The eval deck's `imageOnly` slides go unused until #108 lands.
- Derived text weakens quotes exactly as `docs/adr/0001-grounding-architecture.md` § Options considered 3 says, and the image beside the citation is the student's only check.

**B. Provenance per field, or derived text as a second source record per slide.** Citations would say exactly which text was read from a picture. Rejected for v1: it reshapes `SlideRecord` and its column (#8, #11) with no measured need, since the owner's deck has no thin page.

**C. OCR as a fifth gateway role.** It would put every model behind one interface. Rejected: OCR is not a language model and is never served at query time, and adding it would reopen `docs/adr/0003-model-roles-and-backends.md` § Decision (a) for nothing the gateway does.

**D. Caption every image automatically**, reading `docs/plan.md` §3.1's "optionally" as a default. Rejected on the owner's direction: the deck's pictures carry no examinable text, and a caption is a model's belief about a picture, which is the thing the hard constraints keep out.

**E. Refuse to cite derived text anywhere**, as `docs/plan.md` §7 item 6's "when to refuse to cite derived text" suggested. Rejected: it hides a slide the student uploaded, and the image beside the citation is a check the student can make.

**F. Gate Ask and notes on confirmation as well as exams.** Safer in principle. Rejected: a wrong derived quote in Ask is one visible sentence with its image beside it, while in an exam it becomes a stored gold answer the student is marked against.

**G. A vision-language verifier that sees the image.** It would check the quote against the picture. Rejected: `docs/adr/0001-grounding-architecture.md` § Decision (d)'s contract is text-only, and ADR 0003 has no such role.

**H. Word error rate as the metric.** It is the field's usual measure. Rejected for its shape: it is not an "of X, those Y" ratio in `docs/adr/0005-evaluation-as-gate.md` § Decision (d)'s form. It can join by amendment if (h)'s two ratios prove uninformative.

## Consequences

**Easier.** `SlideRecord`, its column and `Citation` all stand unchanged. The exam gate reuses an existing resolution check, so no verifier rule is added. This ADR carries no tunable value.

**Harder.** Every derived citation needs the full stored rendering in the UI. The installer carries a second family of model files. PPTX has no page renderer (A8). Each OCR dependency needs an egress decision from the owner.

**Explicitly accepted.** The derived flag is coarse: one per record. No captioner in v1. Confirmations do not survive a rebuild. Correcting derived text in the slide browser, rather than confirming it, is not decided here (#111).

**What would make us revisit.** (h)'s first run showing recall too low for derived quotes to resolve; (e)'s trigger firing; or a real deck on which thin pages are the common case, which would reopen (a)'s premise that OCR is a correctness path for the rare page.

## Amendments

- **2026-10-20 — (c)'s pin sentence annotated for `docs/adr/0003-model-roles-and-backends.md` § Decision (e)'s amended shape** (#124).
  - (c) cited (e)'s shape when that shape was one artefact file and its sha256 for every pin. ADR 0003's amendment of 2026-10-20 (its § Amendments) keeps that form for the generator, whose GGUF file is self-contained. An encoder pin gains a `manifest` of per-file digests, and its `sha256` becomes the manifest's digest.
  - The OCR pin takes the manifest form, because neither candidate in (d) loads one self-contained file. tesseract.js loads its worker, its core and its language data. PP-OCRv5 loads a detection model, a recognition model and its dictionary. The file set that pin names is #108's, with the adapter.
  - The decision in (c) is unchanged: OCR remains an ingest adapter whose pin the eval report records. Only the cited shape is annotated, inline at (c).
