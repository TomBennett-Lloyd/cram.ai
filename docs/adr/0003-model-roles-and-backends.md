# 0003 — Model roles and backends: four roles, each configured alone; encoders in-process, the generator in-process or over private HTTP; candidates measured, not pinned

- **Status:** accepted
- **Date:** 2026-10-19
- **Issue:** #3

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into cited answers, revision notes and practice exams. This ADR decides which models do that work, how each is reached, and what decides which models those are.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. It answers three of those bullets:

- the one headed "No course content leaves the machine it was uploaded to", which bounds where every model may run;
- the one headed "Nothing is publicly reachable", which bounds what a backend may listen on or point at;
- the one headed "Open-weight, permissively licensed models only", which bounds the candidates.

The machine is the one issue #3's target-machine comment describes (owner, 2026-10-13): a CPU-only Windows laptop with a few GB of memory free for models once the operating system and the app have taken theirs. The owner decided on 2026-10-13 (#7) that this laptop is where performance is measured. A VM on the development Mac cannot measure it.

Several accepted decisions deferred to this ADR:

- `docs/adr/0001-grounding-architecture.md` § Decision (d) fixes the verifier contract and leaves how the verdict is computed to this ADR. § Options considered 4 expected this ADR to measure both shapes on the target machine. This ADR cannot meet that: nothing exists to measure with yet. It decides the decision rule instead and names who runs it ((d)).
- `docs/adr/0002-deployables.md` § Decision (c) leaves the runtime per run mode to this ADR. § Decision (f) places #26's rented private host without adopting it.
- `docs/adr/0004-storage.md` § Decision (c) leaves the embedding model, the vector dimension and the reranker's model to this ADR.
- `docs/adr/0005-evaluation-as-gate.md` § Decision (f) has the eval report name "the model pin per role, as ADR 0003 names them". § Decision (g) maps model config to "wherever ADR 0003 places it". § Decision (h) has this ADR deliver the pins a report names.

What exists:

- `Verdict` in `packages/shared/src/verification.ts`, the verifier's output vocabulary.

What is pending, and whose:

- the gateway (#12);
- the grounding pipeline (#13);
- retrieval (#11);
- the eval deck (#14);
- the runner and its reports (#47);
- the dev setup script (#20);
- desktop packaging (#7, ADR 0007).

No model has run in this repo, so every figure below is an `Assumption:` with the command that checks it ((k)). The first measured pins are #47's first tier-2 run to record.

## Decision

- **(a) Four roles, each configured independently: `generator`, `verifier`, `embedder`, `reranker`.**
  - Each role has its own backend, pin and settings.
  - No feature names a model; a feature names a role.
  - Every place an LLM writes text uses `generator`: answer generation, the rewrite that `docs/adr/0001-grounding-architecture.md` § Decision (d)'s policy set allows, topic tagging, exam generation and the grading judge. The verifier's LLM path in (d) is the generator role under a verifier prompt that `packages/grounding` owns. It is not a fifth role.
  - `reranker` is optional. Absent config means no rerank. Whether and where retrieval reranks is #11's.
- **(b) The gateway returns model outputs, never grounding decisions.**
  - It has one capability per role:
    - constrained-JSON chat (generator);
    - embeddings (embedder);
    - pair relevance scores (reranker);
    - three-class entailment scores over a (premise, hypothesis) pair (verifier).
  - The entailment capability is new against #12's body, which lists only chat, embed and rerank.
  - Mapping scores or chat output to a `Verdict` is a pure function in `packages/grounding` (#13). That is the pure-core split `docs/standards/architecture.md` rule 3 sets and `docs/adr/0001-grounding-architecture.md` § Consequences relies on, so the verifier contract is testable against a fake gateway.
  - Operation names and signatures are #12's.
- **(c) Backends by role and run mode.** There are two backend families.
  - **In-process**:
    - `node-llama-cpp` for GGUF decoder models (the generator);
    - `onnxruntime-node` for encoder models (embedder, verifier, reranker).
  - **OpenAI-compatible HTTP**, for the generator only, to one of:
    - a server on loopback (Ollama, in developer mode);
    - a server on the owner's private network (a llama.cpp server or vLLM, in `docs/adr/0002-deployables.md` § Decision (e) and (f)'s shapes).

  | Run mode                                                                    | generator                        | embedder, verifier, reranker |
  | --------------------------------------------------------------------------- | -------------------------------- | ---------------------------- |
  | Installed app                                                               | in-process, `node-llama-cpp`     | in-process, ONNX Runtime     |
  | Developer mode                                                              | HTTP to Ollama on loopback       | in-process, ONNX Runtime     |
  | Private host (#26; placed by `docs/adr/0002-deployables.md` § Decision (f)) | HTTP to the owner's private host | in-process, ONNX Runtime     |

  The encoders run in-process in every mode, by owner decision on 2026-10-19 (the plan's Q4), for reproducibility — the owner's words: "the onnx runtime in every mode reduces the variability", so that results seen in development can be reproduced. The index is local in every mode (`docs/adr/0004-storage.md` § Decision (a)), so a course's vectors and its verdicts are computed by the same runtime from the same artefact whatever the mode. #26 would then relocate only the generator's prompts.

  The generator's backend still differs between developer mode (Ollama) and the installed app (`node-llama-cpp`). Both are llama.cpp underneath, and the difference is narrowed in two ways:
  - both load the same pinned artefact ((e));
  - both run with the deterministic settings that `docs/adr/0005-evaluation-as-gate.md` § Decision (e) asks a tier-2 run to use.

  A dev-class measurement of the generator is therefore evidence about the installed app, not proof of it. That is why § Decision (e) of that ADR owes a target-class run before a release.

  No config in this repository names an endpoint outside loopback or the owner's private network (`docs/adr/0002-deployables.md` § Decision (d)).

- **(d) The verifier: both shapes are built and measured, and the NLI cross-encoder is the provisional default.**
  - The two shapes, both behind (b), both meeting `docs/adr/0001-grounding-architecture.md` § Decision (d)'s contract:
    - an NLI cross-encoder, where the hypothesis is the unit's text and the premise is the union of its quotes;
    - the generator under a strict verifier prompt.
  - The provisional default, by owner decision on 2026-10-19 (the plan's Q3): the cross-encoder first, with the LLM path only as a second opinion on `partial`.
  - An input longer than the verifier model's maximum length is never truncated. A truncated premise can drop the quote that supports the unit, or the clause that contradicts it. The input goes to the second opinion if one is configured, and is otherwise returned `unsupported`: the verifier fails closed.
  - Owned by #13, not here:
    - the mapping from scores to a `Verdict`;
    - the claim split that makes `partial` expressible from a three-class model;
    - its thresholds. These are tuned inputs that name `eval/labels/` as what they are tuned against (`docs/standards/architecture.md` rule 12).
  - **Measurement decides** which shape is primary and whether the second opinion stays. The rule carries no number of its own (`docs/adr/0005-evaluation-as-gate.md` § Decision (j)):
    - The cross-encoder stays primary iff, on #47's first tier-2 run, it holds the contradiction set at its bar (`CLAUDE.md` § Hard constraints, "The slides win") and its verifier precision (`docs/adr/0005-evaluation-as-gate.md` § Decision (d)) is not below the LLM path's.
    - The second opinion stays iff adding it raises verifier recall without lowering precision or failing the contradiction set.
    - Per-unit verifier latency on the target machine class is the tiebreak.
    - #47's first run records this on the development class; the target-class run before a release (`docs/adr/0005-evaluation-as-gate.md` § Decision (e)) confirms it.
- **(e) The pin shape.**
  - A pin is `{role, backend, model, artefact, sha256, licence}`, and an encoder pin adds `manifest` (amended 2026-10-20; § Amendments):
    - `model` is the upstream repository id;
    - `artefact` is the repository and file, which fixes the quantisation;
    - `manifest`, on an encoder pin only, is the sha256 of `artefact.file`, `tokenizer.json`, `tokenizer_config.json` and `config.json`, each by its path in the snapshot, and on the embedder its pooling;
    - `sha256` is the generator artefact's digest, and on an encoder pin the digest of its manifest's canonical JSON;
    - `licence` is an SPDX id, or the licence's own name where SPDX has none.
  - This is `docs/adr/0005-evaluation-as-gate.md` § Decision (f)'s "model pin per role". A report records the pins that ran, not the defaults.
  - The embedder pin's (model, sha256) is the embedder identity that `docs/adr/0004-storage.md` § Decision (c) has the course file record. A different digest is a different embedder, and the course is re-embedded rather than searched.
  - The vector dimension is read from the embedder artefact when an index is created. It is never written as a literal in code.
- **(f) Role config lives in `packages/gateway` (answers `docs/adr/0005-evaluation-as-gate.md` § Decision (g)).**
  - The role-config schema, the pin schema and the provisional default pins are exported once from that package. `packages/index` and `eval/` import them from there, the direction `docs/standards/architecture.md` rule 1 allows.
  - So `check:eval-report`'s `packages/gateway` member already covers model config, and model config needs no trigger path of its own.
  - Runtime overrides are read by the server at start from its own configuration outside the repo (#15), validated by the same schema.
  - File names are #12's.
- **(g) Candidates per role, with their licences.**
  - Licences are read under the bullet cited above as OSI-style permissive (Apache-2.0, MIT, BSD), by owner decision on 2026-10-19 (the plan's Q1).
  - A candidate model's own licence decides admission (the plan's Q2). Terms on the datasets a candidate was trained on are recorded beside it as a caveat, and the clean candidate is preferred when measurement ties.
  - Courses are English-only, by owner decision on 2026-10-19 (the plan's Q6).
  - The provisional default per role is the first admitted row. The reranker has no default.
  - Re-pinning is a code change in `packages/gateway` argued by an eval report, not an amendment to this ADR.

  | Role                | Candidate                                        | Licence                     | Admission and caveats                                                                                 |
  | ------------------- | ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------- |
  | generator           | `Qwen/Qwen3-4B` (GGUF from `Qwen/Qwen3-4B-GGUF`) | apache-2.0                  | admitted; provisional default; thinking mode must be suppressible (A12)                               |
  | generator           | `microsoft/Phi-4-mini-instruct`                  | mit                         | admitted; no first-party GGUF, so its artefact is a third-party conversion whose digest the pin fixes |
  | generator (smaller) | `HuggingFaceTB/SmolLM3-3B`                       | apache-2.0                  | admitted; the step down if A3 fails at 4B                                                             |
  | generator (smaller) | `ibm-granite/granite-3.3-2b-instruct`            | apache-2.0                  | admitted; the step down if A3 fails at 4B                                                             |
  | generator           | `google/gemma-3-4b-it`                           | Gemma Terms of Use          | not admitted: not a permissive licence                                                                |
  | generator           | `meta-llama/Llama-3.2-3B-Instruct`               | Llama 3.2 Community License | not admitted: not a permissive licence                                                                |
  | verifier            | `cross-encoder/nli-deberta-v3-base`              | apache-2.0                  | admitted; provisional default; trained on SNLI and MultiNLI                                           |
  | verifier            | `cross-encoder/nli-deberta-v3-small`             | apache-2.0                  | admitted; the step down if the base model's latency fails                                             |
  | verifier            | `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`   | mit                         | admitted with a caveat: its training data includes ANLI, whose terms are non-commercial (A14)         |
  | embedder            | `BAAI/bge-small-en-v1.5`                         | mit                         | admitted; provisional default; English-only, which the courses are                                    |
  | embedder            | `nomic-ai/nomic-embed-text-v1.5`                 | apache-2.0                  | admitted; needs task prefixes on queries and documents                                                |
  | reranker            | `cross-encoder/ms-marco-MiniLM-L6-v2`            | apache-2.0                  | admitted with a caveat: trained on MS MARCO, whose terms are non-commercial (A14)                     |
  | reranker            | `BAAI/bge-reranker-base`                         | mit                         | admitted                                                                                              |

  `BAAI/bge-m3` and `BAAI/bge-reranker-v2-m3`, which `docs/plan.md` §3.3 named, are dropped for size on the target machine. So are the 8B and 14B generators it named.

- **(h) The selection criterion, and the latency premise it rests on.**
  - Ask is the only interactive path. Exam papers are generated into a background pool, and notes are generated once per category and cached. This is the pool that `docs/adr/0002-deployables.md` § Decision (g) cites.
  - So the generator is chosen by Ask latency on the target machine class, then by `docs/adr/0005-evaluation-as-gate.md` § Decision (d)'s metrics. Exam generation speed does not choose it.
  - On a CPU-only machine, prompt processing, not generation, is expected to dominate Ask's time to first token (A4). Two things follow:
    - #13's prompts put their fixed text first, so that a backend's prompt-prefix cache applies (A11);
    - retrieval k and slide length are latency parameters as well as recall parameters (#11 owns k).
- **(i) Weights are loaded from local paths only.**
  - No role fetches weights at inference time.
  - Getting weights onto the machine is someone else's decision:
    - in the installed app, ADR 0007's (#7), including any first-launch download, which the owner confirmed on 2026-10-19 (the plan's Q5: "yeah you can download the weights");
    - in developer mode, #20's.
  - Every pin's digests (the generator's `sha256`, an encoder's `manifest`) let either path verify what it fetched.
  - A runtime dependency that can download weights (`node-llama-cpp` exports a model downloader) or that ships a native addon is detected by `.claude/scripts/check-no-network-egress.sh`. Its allow-list entry is the owner's decision at the ticket that adds the dependency (#18).
  - No role trains, fine-tunes or adapts on course content. A course's text reaches a model only as a prompt or an input pair, and only on a machine (c) admits. The bound is the first `CLAUDE.md` bullet cited above, cited, not restated. That covers the owner's question of 2026-10-19 ("we don't want to have our data used for training"). The training-data caveats in (g) are about the datasets the candidate models were trained on, never about the student's data.
- **(j) Relocating the generator is placed, not adopted.**
  - Moving the generator to a stronger machine the student controls, or to the owner's private host (#26), is (c)'s HTTP backend on the generator role alone; the encoders stay on the laptop.
  - Adopting it is the owner's explicit decision (`docs/adr/0002-deployables.md` § Decision (f)).
  - The evidence that opens that decision: a target-class run whose Ask latency the owner judges unusable, or exam quality below its metrics, after the in-laptop steps in § Consequences have been tried.
- **(k) Assumptions.** Each is checked before anything is built on it, and the ticket named in (l) records the result. The memory budget is stated as an expression and never as a computed total (`docs/standards/architecture.md` rule 12).
  - Assumption: A1 — each candidate's licence is as (g) tables it. Check: `curl -s https://huggingface.co/api/models/<repo> | jq -r .cardData.license`, then read the repository's licence file.
  - Assumption: A2 — each artefact's size and digest, which the pin records. Check: `curl -s "https://huggingface.co/api/models/<repo>?blobs=true" | jq -r '.siblings[] | select(.rfilename == "<file>") | [.size, .lfs.sha256] | @tsv'`. A file stored outside LFS has no `lfs.sha256`, so an encoder's tokenizer and config digests are `curl -sfL https://huggingface.co/<repo>/resolve/<revision>/<file> | shasum -a 256`, at a revision whose model `lfs.sha256` is the one the manifest records.
  - Assumption: A3 — the resident set of every loaded role fits the memory left on the target machine. That set is generator weights + context length × KV-cache bytes per token + the encoders + runtime buffers. Planning arithmetic suggests the 4B default with a long f16 context does not fit, before the encoders load. Check: `npx --yes node-llama-cpp inspect estimate <gguf>` on the development machine across context lengths and KV-cache types, then `npx --yes node-llama-cpp inspect measure <gguf>` on the target machine.
  - Assumption: A4 — Ask's time to first token on the target machine is dominated by prompt processing (#3's comment expects tens of seconds at 4B). Check: #47's target-class run records time to first token and tokens per second per role.
  - Assumption: A5 — the cross-encoder verifies a unit in well under a second on the target CPU. Check: #47's target-class run records per-unit verifier latency for both arms.
  - Assumption: A6 — the provisional verifier's maximum input length is 512 tokens. Check: `curl -sL https://huggingface.co/cross-encoder/nli-deberta-v3-base/resolve/main/tokenizer_config.json | jq .model_max_length`.
  - Assumption: A7 — the provisional verifier's labels are ordered contradiction, entailment, neutral. #66 reads the order from the artefact rather than hard-coding it. Check: `curl -sL https://huggingface.co/cross-encoder/nli-deberta-v3-base/resolve/main/config.json | jq -c .id2label`.
  - Assumption: A8 — `onnxruntime-node` ships prebuilt binaries for win32-x64 and darwin-arm64, and its install script fetches only the optional CUDA execution provider. Check: `npm pack onnxruntime-node@<version> && tar -tzf onnxruntime-node-<version>.tgz | command grep -E 'napi-v[0-9]+/(win32/x64|darwin/arm64)/'`, then read the package's install script.
  - Assumption: A9 — `node-llama-cpp` exposes embedding and ranking contexts, JSON-schema-constrained output and a model downloader, and no classification context. That last gap is why NLI runs on ONNX Runtime. Check: `npm pack node-llama-cpp@<version> && tar -xzf node-llama-cpp-<version>.tgz && command grep -rE 'createRankingContext|createEmbeddingContext|createModelDownloader|classif' package/dist --include='*.d.ts' -l`.
  - Assumption: A10 — Ollama's OpenAI-compatible API serves chat with JSON-schema output, and serves neither rerank nor entailment. Check: Ollama's `docs/openai.md` at the version #20 pins.
  - Assumption: A11 — each generator backend reuses a cached prompt prefix across calls. Check: #12/#13 measure the second Ask's time to first token against the first's with the same fixed prefix.
  - Assumption: A12 — Qwen3's thinking output can be suppressed in both generator backends. Check: count output tokens with `node-llama-cpp`'s `QwenChatWrapper` `thoughts: "discourage"` and with Ollama's equivalent setting in #12.
  - Assumption: A13 — the target CPU has AVX-512 VNNI, which selects ONNX Runtime's fastest CPU kernels for quantised encoders. Check: Intel's specification page for the i5-1035G1 ("Intel Deep Learning Boost"), then ONNX Runtime's provider log on the target machine.
  - Assumption: A14 — ANLI's and MS MARCO's terms are non-commercial. Check: `curl -s https://huggingface.co/api/datasets/facebook/anli | jq -r .cardData.license`, and MS MARCO's terms page.
- **(l) What each ticket delivers.**
  - This ADR delivers the decision.
  - #12: the role config, the pin schema and the provisional defaults ((e), (f)); the OpenAI-compatible HTTP adapter; and a fake gateway that covers entailment.
  - #66: the in-process ONNX Runtime adapter for the three encoder roles.
  - #13: the score-to-`Verdict` mapping, both verifier prompts, and the prefix-cacheable prompt layout.
  - #11: whether to rerank, and the vector dimension read from the embedder pin.
  - #47: both verifier arms measured, (d)'s rule applied, the first measured pins recorded, and per-role latency in the report beyond `docs/adr/0005-evaluation-as-gate.md` § Decision (f)'s floor.
  - #20: pulls only the generator, since Ollama serves no encoder role.
  - #7 and M5 (`docs/plan.md` §8): the `node-llama-cpp` adapter, weight acquisition, and the allow-list entries both runtimes need.
- **(m) Restatement ledger**, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes, following `docs/adr/0004-storage.md` § Decision (h)'s precedent. Owned here: the role set in (a), the backend-per-role-and-mode rule in (c), the verifier rule in (d), the pin shape in (e) (declared since its 2026-10-20 amendment at `.claude/ledgers/model-pin-shape.ledger`; § Amendments) and the config location in (f).

  Sweep: `git grep -n -iE '0003-model-roles|ADR 0003|node-llama-cpp|onnx|ollama|vllm|embedder|rerank|cross-encoder|(^|[^a-z])NLI([^a-z]|$)|model (pin|config|choice|size)|model and hardware|role config|gguf|qwen|gemma|phi-4|llama 3|deberta|bge|nomic' -- ':/' ':/!docs/adr/0003-model-roles-and-backends.md' ':/!pnpm-lock.yaml'`, whose first two arms are the citation arms. Run at `60c6317` on 2026-10-19 for branch `3-adr-0003-model-roles`, with this change's edits in the working tree. Its hits, by file:

  - Carriers citing this file by path: `docs/plan.md` §7 item 3 (the scope line) and the status line; `docs/plan.md` §5's `gateway/` layout row, which names role config and both adapter families without citing.
  - Carrier not citing this file: `docs/plan.md` §3's diagram (the role split, an illustration that cannot cite).
  - Cites by path: `docs/plan.md` §3.3, a pointer that replaced the roles, backends, verifier and candidates in the same change; §3.2's first bullet and §9 q1; `docs/standards/grounding.md` rule 4.
  - Index row: `docs/adr/README.md` § Index (this ADR's row).
  - Ledger entry: `.claude/ledgers/contradiction-set-bar.ledger`'s `carrier:` line naming this file, a carrier of `CLAUDE.md`'s contradiction-set bar, which (d) argues from, and of nothing owned here.
  - Immutable ADRs that defer to this one by number: `docs/adr/0001-grounding-architecture.md` § Decision (d) and § Options considered 4 (whose expectation that this ADR measures is answered in § Context); `docs/adr/0002-deployables.md` § Decision (c) and § Consequences; `docs/adr/0004-storage.md` § Decision (c); `docs/adr/0005-evaluation-as-gate.md` § Decision (f), (g) and (h).
  - Non-carriers: `CLAUDE.md` § Hard constraints' first bullet and § Commands' `pnpm eval` line, which name inference, reranking and model config as categories without placing them.
  - Left standing: `docs/plan.md` §3.6 (the desktop app and developer-mode bullets, ADR 0007's surface), §7 item 7 (ADR 0007's scope line), and §8 M1, M5 and M6 (milestone scope lines, consistent with (c) and (l)).
  - Past-tense record: `docs/review-feedback.md`'s entries for #1 and #4 (asks naming the verifier and the embedder), and this ADR's five entries for #3.

## Options considered

**A. Three roles, with the reranker inside retrieval.** It matches `docs/plan.md` §3.3's draft and #12's body. Rejected: the reranker is a model with its own pin, licence and memory cost, and `docs/adr/0004-storage.md` § Decision (c) already hands its model to this ADR. Leaving it out of the role set leaves it a model with no config.

**B. One backend family per run mode**: everything in `node-llama-cpp` in the installed app, everything through Ollama in developer mode. One runtime per mode, the shape `docs/plan.md` §3.3 drafted. Rejected for three reasons:

- `node-llama-cpp` has no classification context (A9), so the NLI verifier could not run in-process;
- Ollama serves no rerank or entailment (A10);
- the embedder would differ by mode, so a course indexed in development would carry a different embedder identity from the same course in the installed app.

**C. An LLM-only verifier**: the generator's weights under a strict prompt. No second runtime, and the verifier understands everything the generator does. Rejected as the default for two reasons:

- each unit costs a full prompt on a CPU-only machine (A5);
- the verifier would share the very weights whose beliefs it exists to exclude (`docs/adr/0001-grounding-architecture.md` § Context), so a belief the generator holds is one the verifier is primed to credit.

It is still built, as (d)'s comparison arm and second opinion.

**D. An NLI-only verifier with no second opinion.** One verifier path to maintain. Rejected as a decision made ahead of measurement: whether the second opinion earns its cost is exactly what (d)'s rule measures.

**E. Role config in `@cram/shared`, or in a package of its own.** `@cram/shared` holds domain schemas that every package reads. Rejected: a pin is gateway configuration, not a domain shape, and only the gateway, the index and the eval runner read it. A package of its own would be a third home for one schema. `docs/standards/architecture.md` rule 2's "defined once" holds either way.

**F. Pins written in this ADR.** The ADR would be the single place to read what runs. Rejected: every re-pin would become an amendment to an immutable record. The eval report already records the pins that ran (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)).

**G. Admitting the Gemma and Llama models.** Both are strong at this size. Rejected by owner decision on 2026-10-19 (the plan's Q1): their licences are not permissive.

**H. The chosen option**: four roles; encoders in-process on ONNX Runtime in every mode; the generator in-process or over private HTTP; both verifier arms built; candidates named and pins measured. Its downsides are genuine and accepted:

- a second native runtime, in M1 (#66) and in the installer (#7);
- two verifier arms to build and measure;
- the generator's backend differs between developer mode and the installed app, narrowed but not removed by (c);
- the first pins wait for #47, so #12 lands with provisional defaults that may not survive measurement.

## Consequences

**Easier.**

- A feature is written against a role, never a model, so a re-pin touches one package.
- The encoders and the index behave identically in every run mode, so dev-class measurements of retrieval and verification transfer to the installed app.
- The verifier is testable against a fake gateway, because the verdict is computed in `packages/grounding`.
- #26 can be evaluated by moving one role.

**Harder.**

- Two native runtimes to package for Windows.
- The memory budget is shared by up to four loaded models on a machine with little to spare (A3).
- Every prompt change in #13 has to keep the prefix-cache layout.

**Explicitly accepted.**

- No pin is decided here.
- Every figure is an assumption until #47 measures it.
- The generator's dev and installed backends differ.

**If A3 fails.** The owner's position, 2026-10-19: the memory limit is the Windows laptop's, and relocation is not adopted from the outset. If the default does not fit, the in-laptop steps come first:

1. a smaller admitted generator ((g)'s 3B and 2B rows);
2. a shorter context, or a quantised KV cache;
3. loading the encoders and the generator sequentially rather than together, where a feature's pipeline allows.

Only if those fail does (j)'s relocation become the owner's decision. The first measured run on the target machine decides which step is reached.

**What would make us revisit.**

- (d)'s rule going against the cross-encoder.
- A3 failing for every admitted generator, including the smaller rows.
- llama.cpp gaining a classification context, which would let one runtime serve every role.
- The owner admitting a non-permissive licence.
- A non-English course, which reopens (g)'s embedder row.

## Amendments

- **2026-10-20 — (e)'s pin shape: an encoder pin's `sha256` digests a manifest** (#124, by the owner's decision on that issue: "issue 124 extend the pin to a manifest").
  - Was: `{role, backend, model, artefact, sha256, licence}` for every role, with `sha256` the digest of one artefact file. The embedder's pooling sat in role config, outside the pin.
  - Now: an encoder pin adds `manifest`, which holds the sha256 of `artefact.file`, `tokenizer.json`, `tokenizer_config.json` and `config.json`, each keyed by snapshot path, plus the embedder's pooling. Its `sha256` is the manifest's digest. The generator pin is unchanged, because a GGUF file carries its own tokenizer. The schema is in `packages/gateway/src/pin.ts` (`EncoderManifest`, `manifestDigest`), and the provisional manifests are in `packages/gateway/src/provisional-pins.ts`.
  - Wrong as written: the tokenizer, `model_max_length`, `id2label` and the pooling each change an encoder's outputs, and none of them moved the digest. So (e)'s embedder identity would not have seen a tokenizer or pooling change, and an eval report's pins would not have identified what ran. The decision stands: the pin identifies what ran, and the shape now does that for the encoders too.
  - Trued up inline, as carriers: (e)'s shape bullets, (i)'s digest line, and A2's check, which gains the command for a file stored outside LFS.
  - Citers that hold under the new shape, so are not annotated: `docs/adr/0004-storage.md` § Decision (c) (the course file records which embedder produced its vectors); `docs/plan.md` §3.3's ownership line, which points here for "the pin shape"; `apps/server/src/slide-embedding.ts`'s `embedderIdentity`, which records `model@sha256` as the course's embedder identity and now moves with the manifest; this ADR's (e) embedder-identity bullet and Options considered B. Also `docs/adr/0005-evaluation-as-gate.md` § Decision (f) ("the model pin per role"), which the sweep did not return: it was found through (e)'s own bullet citing it and § Context's quotation of it.
  - Sweep: ``git grep -n -iE '0003-model-roles[^ ]*\.md`? § Decision \(e\)|ADR 0003 \(e\)|pin shape|embedder identity|re-embedded|sha256|pooling|tokenizer_config|tokenizer\.json|(^|[^a-z])config\.json|EmbedderConfig|model_max_length|id2label' -- ':/' ':/!pnpm-lock.yaml'``, run at `16988d1` on 2026-10-20 for branch `124-pin-manifest`, before its first edit.
  - Annotated, as a quoting ADR: `docs/adr/0006-image-only-slides.md` § Decision (c)'s pin sentence, which puts the OCR pin in (e)'s shape. It now names the manifest form and carries its own dated entry. It and `slide-embedding.ts` merged after the sweep's commit and were found by the ledger's sweep on rebase.
  - Restatement ledger: the pin shape's share of (m) is declared at `.claude/ledgers/model-pin-shape.ledger`, and `check:ledgers` re-runs its sweep. The other values (m) owns have not moved, so they stay in its prose form.
