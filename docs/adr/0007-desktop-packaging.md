# 0007 — Desktop packaging: an Electron shell around the one server; an unsigned NSIS installer from CI; weights downloaded at first launch by digest; OCR data inside

- **Status:** proposed
- **Date:** 2026-10-20
- **Issue:** #7

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into cited answers, revision notes and practice exams. This ADR decides how the app reaches that student's Windows laptop: the shell around the server, the installer and how it is built, how model weights get onto the machine, and what is and is not signed.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. It answers three of those bullets:

- the one headed "No course content leaves the machine it was uploaded to", which bounds the one outbound connection the installed app makes;
- the one headed "Nothing is publicly reachable", which bounds what the shell may listen on or load;
- the one headed "Open-weight, permissively licensed models only", which bounds what that connection downloads.

The machine is the one issue #3's target-machine comment describes: a CPU-only Windows x64 laptop with little memory to spare. The user is not technical (`docs/plan.md` §3.6, owner decision 2026-10-13).

Owner decisions this ADR records rather than reopens, each from #7's comments:

- **2026-10-13, signing:** "skip code signing. The installer ships unsigned; the install guide carries the two-click SmartScreen instruction."
- **2026-10-13, testing:** "a free VM on the dev Mac (VMware Fusion or UTM, Windows 11 ARM) for installer/UI, the user's laptop for the performance measurement."
- **2026-10-19, weights:** the first-launch download, confirmed on #3 ("yeah you can download the weights") and recorded in `docs/adr/0003-model-roles-and-backends.md` § Decision (i).

Accepted decisions that defer to this one:

- `docs/adr/0002-deployables.md` § Decision (b) leaves the packaging specifics here.
- `docs/adr/0003-model-roles-and-backends.md` § Decision (c) puts two native runtimes in the installed app; (i) leaves getting weights onto the machine here; (l) gives "#7 and M5" the `node-llama-cpp` adapter, weight acquisition and both runtimes' allow-list entries.
- `docs/adr/0004-storage.md` § Decision (c) and § Options considered A leave it here to check that `better-sqlite3` "builds for the desktop shell", and that `sqlite-vec` ships with it.
- `docs/adr/0005-evaluation-as-gate.md` § Decision (e) owes a run on the target machine class before a release, "M5's to schedule".
- `docs/adr/0006-image-only-slides.md` § Decision (c) and (d) make OCR an ingest adapter running a pinned engine. Its provisional default fetches its worker, core and language data from a CDN unless pointed at local paths (its A2), and § Consequences leaves shipping those files to this ADR.

What exists:

- `packages/index`, with `better-sqlite3` and `sqlite-vec` (#11), and their `allowBuilds` entries in `pnpm-workspace.yaml`;
- `packages/gateway`'s in-process ONNX Runtime adapter for the three encoder roles (#66);
- `apps/server` (#15): its loopback bind, asserted by `apps/server/src/server.test.ts`'s "listens on the loopback interface only", and its data directory, resolved by `resolveDataDir` in `apps/server/src/data-directory.ts`.

What is pending, and whose:

- the OCR adapter (#108);
- the eval runner (#47) and the target-class retrieval measurement (#69);
- developer-mode weights (#20);
- the shell and the downloader (#161), the installer (#162), the `node-llama-cpp` generator adapter (#163) and the first dry run on the target laptop (#164), filed for this ADR.

### Divergences from the issue

The issue's title and `docs/plan.md` §3.6 were written before ADRs 0003, 0004 and 0006 and before anything was checked against the packages. Where they and this ADR differ:

- **D1 — two native runtimes, not one.** `docs/adr/0003-model-roles-and-backends.md` § Decision (c) runs the generator on `node-llama-cpp` and the embedder, verifier and reranker on `onnxruntime-node`, in-process in the installed app. "Electron + node-llama-cpp" is half of what the installer carries.
- **D2 — "the only outbound connection the app ever makes" is narrowed to the installed app, and to more than one host.** Developer mode's loopback Ollama and #20's model pull are outside the claim, as is the CI build's own tool download (A7). The download's hosts are `huggingface.co` and the CDN hosts its redirects name (A11).
- **D3 — nothing is built against the shell's Node ABI.** Every native addon the app loads ships N-API prebuilt binaries (A2–A4), which load under Electron's bundled Node without a rebuild, and `vec0.dll` is a plain SQLite loadable extension (A5). `docs/adr/0004-storage.md`'s "builds for the desktop shell" is answered by (d): no build, proven by loading.
- **D4 — a second family of model files ships inside the installer, not by download:** the pinned OCR engine's files ((g)).
- **D5 — `node-llama-cpp`'s own downloader is not the download mechanism.** It verifies no digest (A12), and a pin's digests (`docs/adr/0003-model-roles-and-backends.md` § Decision (e): the generator's `sha256`, an encoder's `manifest`) are what a download must be checked against. The downloader is first-party ((e)).
- **D6 — the egress gate cannot see a first-party downloader.** `.claude/scripts/check-no-network-egress.sh`'s census covers third-party packages; its header leaves first-party network code to review. (e) confines first-party network code to one module under a named test, and extending the census is #165.
- **D7 — no M5 tickets existed.** #161–#164 were filed for this ADR, so that (m) names real tickets.

## Decision

- **(a) The shell is Electron, in `apps/desktop`, and it is a build input to the one deployable** (`docs/adr/0002-deployables.md` § Decision (a)). The main process starts the same server module `pnpm dev` runs, in-process (`docs/adr/0002-deployables.md` § Decision (b)). The renderer loads the SPA from that server over loopback. The shell refuses navigation and `window.open` to any origin but the server's, and a named test in `apps/desktop` (#161) holds that. There is no `autoUpdater` and no `publish` configuration ((i)). Electron is a devDependency, as `electron-builder` expects, so it is outside `.claude/scripts/check-no-network-egress.sh`'s census of production dependencies. That gap is accepted, and it is held by the named test above and A16's capture.
- **(b) Binding is loopback only, by citation.** The rule is `docs/adr/0002-deployables.md` § Decision (d)'s. The shell opens no listener of its own; the port is the server's, handed to the renderer, never a user-facing setting. The mechanical assertion stays `apps/server/src/server.test.ts`'s loopback test.
- **(c) The installer is `electron-builder`'s NSIS target, built on GitHub Actions' Windows x64 runner (A8) by a release workflow of its own, and published as a GitHub Release asset.** The release workflow is separate from `.github/workflows/ci.yml`'s checks. The install is one-click and per-user, `electron-builder`'s NSIS default (A6), so it asks for no administrator rights. Uninstalling leaves the data folder; deleting a course is `docs/adr/0004-storage.md` § Decision (e)'s file deletion, done from the app. The build's own tool downloads (A7) are build-time traffic on the runner, pinned by the `electron-builder` version, and not the app's.
- **(d) Native binaries ship as published: N-API prebuilds, unpacked from the asar, with no rebuild.** The binaries are `better-sqlite3`'s `prebuilds/win32-x64.node` (A2), `onnxruntime-node`'s `bin/napi-v6/win32/x64/onnxruntime_binding.node` (A3), `@node-llama-cpp/win-x64`'s `bins/win-x64/llama-addon.node` with its CPU-variant libraries (A4), and `sqlite-vec-windows-x64`'s `vec0.dll` (A5). The build sets `npmRebuild: false` and unpacks every `.node` and `.dll` from the asar, since a native library loads from a real path. The proof is a headless smoke run of the built installer on the runner (#162): it opens a course file, loads `vec0`, runs one encoder and loads the generator binding. If any addon fails it, the fallback is `@electron/rebuild` against the shipped Electron version (A1), which is the build `docs/adr/0004-storage.md` expected.
- **(e) Weights arrive by a first-launch download, verified by digest, into the data folder.** For every pin `packages/gateway` exports (`docs/adr/0003-model-roles-and-backends.md` § Decision (e) and (f)), and for every file that pin names, the downloader:
  - fetches `https://huggingface.co/<repository>/resolve/<revision>/<file>`;
  - streams it to a temporary file;
  - verifies it against the pin's digest for that file, deleting it and reporting on a mismatch;
  - renames it into `<data folder>/models/`.

  A generator pin names one GGUF file and its `sha256`. An encoder pin names the files its `manifest` lists, each with its own digest, and its `sha256` is the manifest's (§ Decision (e) of that ADR, as amended 2026-10-20).

  An interrupted download resumes on the next launch. Until every pin is present, the app shows only the download screen. A re-pin is downloaded at the next launch after the release that carries it; otherwise the installed app makes no outbound connection. The downloader is first-party code in one module of `apps/desktop` (#161), using Node's `fetch`. It is the only first-party module that opens a connection (D5, D6).

- **(f) What the connection carries, and how that meets the hard constraint.** A request carries the pin's repository, revision and file name and nothing else. The downloader reads nothing from the data folder but the `models/` files it writes, and a named test (#161) asserts that its request URLs are a function of the pins alone. No course exists at first launch, and a re-pin download opens none. What the host sees is a public file fetched from an IP address. The download is therefore not course content leaving the machine. The one third-party dependency involved that can open a connection, `node-llama-cpp`, gets its allow-list entry, in the allow-list `.claude/scripts/check-no-network-egress.sh` owns, from the owner at #163 (`docs/adr/0003-model-roles-and-backends.md` § Decision (i); #18).
- **(g) The pinned OCR engine's files ship inside the installer** as packaged resources, and the adapter is pointed at their local paths (`docs/adr/0006-image-only-slides.md` § Decision (d) and its A2); they are never downloaded at run time. For the provisional default, `tesseract.js`, those files are its worker, its core and its English language data. A changed OCR pin is an app release. They are treated differently from the weights because they are small (A13) and pinned to the engine's version, so the two only ever move together.
- **(h) Code signing is deferred: the installer is unsigned** (owner decision 2026-10-13, #7). The consequence is SmartScreen's "Windows protected your PC" dialog on every freshly downloaded installer, cleared by "More info", then "Run anyway" (A18). The install guide #162 writes carries that instruction. What un-defers signing: a second user, or a signing service available to the owner as an individual (A19). `electron-builder`'s `win.azureSignOptions` is the hook (A6). This answers `docs/plan.md` §9 q4.
- **(i) A release is a GitHub Release carrying the installer.** A new version is a new installer the user runs over the old one. There is no updater, for the reason `docs/adr/0002-deployables.md` § Options considered C gives. The weights are not release assets ((e); A9, A10).
- **(j) The data folder.** Its location is the server's own, `resolveDataDir` in `apps/server/src/data-directory.ts` (`docs/adr/0004-storage.md` § Decision (a)). It is the operating system's per-user application-data folder unless `CRAM_DATA_DIR` overrides it (A14). The shell passes nothing, so the installed app and `pnpm dev` resolve the same folder by the same code. Course files sit where `courseFilePath` in that module puts them, and downloaded models sit in `models/` beside that folder, outside every course file (`docs/adr/0004-storage.md` § Decision (b)). The installer never writes there.
- **(k) Testing surfaces and the release gate** (answers `docs/plan.md` §9 q3). Each surface proves one thing:
  - The Windows 11 ARM VM on the development Mac (owner decision 2026-10-13) proves the installer, the SmartScreen path, the first-launch download and the UI, running the x64 build under Windows' x64 emulation.
  - The runner's headless smoke ((d)) proves x64 native loading.
  - The user's laptop proves performance. Before the first release, the target-class tier-2 run `docs/adr/0005-evaluation-as-gate.md` § Decision (e) owes, and the `inspect measure` of `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A3, run there (#164). What that run must show is that ADR's to state; its findings are filed as issues (`docs/plan.md` §8 M5).
- **(l) Assumptions.** Each is checked before anything is built on it, and the ticket (m) names for it records the result. "Read on 2026-10-20" marks one checked while this ADR was written. Sizes are approximate by form (`docs/standards/prose.md` rule 2), never totals.
  - Assumption: A1 — the current stable Electron, 44.9.2, bundles Node 24.22.0 (read on 2026-10-20). Check: `curl -s https://releases.electronjs.org/releases.json | jq -r '.[] | select(.version=="44.9.2") | .node'`.
  - Assumption: A2 — `better-sqlite3@13.0.3` ships `prebuilds/win32-x64.node`, built against N-API (read on 2026-10-20; `pnpm-workspace.yaml`'s `allowBuilds` comment rests on it). Check: `npm pack better-sqlite3@13.0.3 && tar -tzf better-sqlite3-13.0.3.tgz | command grep -E 'prebuilds/win32-x64\.node'`, then (d)'s smoke.
  - Assumption: A3 — `onnxruntime-node@1.30.0` ships `bin/napi-v6/win32/x64/onnxruntime_binding.node` (read on 2026-10-20); the DirectML libraries beside it go unused on CPU. Check: `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A8's command.
  - Assumption: A4 — `@node-llama-cpp/win-x64@3.22.2` ships `bins/win-x64/llama-addon.node` and the ggml CPU-variant libraries, and `node-llama-cpp@3.22.2` detects that it runs in Electron (read on 2026-10-20). Check: `npm pack @node-llama-cpp/win-x64@3.22.2 && tar -tzf node-llama-cpp-win-x64-3.22.2.tgz | command grep -E 'llama-addon\.node|ggml-cpu'`, and `npm pack node-llama-cpp@3.22.2 && tar -xzf node-llama-cpp-3.22.2.tgz && command grep -rlE 'runningInElectron' package/dist | head -1`.
  - Assumption: A5 — `sqlite-vec-windows-x64@0.1.9` is `vec0.dll` alone (read on 2026-10-20), and `better-sqlite3`'s `loadExtension` needs it at a real file path. Check: `npm pack sqlite-vec-windows-x64@0.1.9 && tar -tzf sqlite-vec-windows-x64-0.1.9.tgz`, then (d)'s smoke.
  - Assumption: A6 — `electron-builder@26.15.3`'s defaults are an NSIS Windows target, `npmRebuild` on, asar on, a one-click per-user NSIS installer, and it offers `win.azureSignOptions` (read on 2026-10-20 from `app-builder-lib`'s `scheme.json`). Check: `npm pack app-builder-lib@26.15.3 && tar -xzf app-builder-lib-26.15.3.tgz && node -e 'const s=require("./package/scheme.json"); console.log(s.definitions.WindowsConfiguration.properties.target.default, s.properties.npmRebuild.default, s.definitions.NsisOptions.properties.oneClick.default, s.definitions.NsisOptions.properties.perMachine.default)'`.
  - Assumption: A7 — the build fetches its NSIS tooling from `electron-userland/electron-builder-binaries` releases on GitHub (read on 2026-10-20). Check: `command grep -rhoE 'electron-builder-binaries/releases/download/nsis[^ "]*' package/out | sort -u` in A6's unpacked tarball.
  - Assumption: A8 — GitHub's `windows-latest` runner is x64. Check: a workflow step running `echo $env:PROCESSOR_ARCHITECTURE` prints `AMD64`.
  - Assumption: A9 — the provisional default pins' artefacts are roughly 2.5 GB (the generator's GGUF), 130 MB (the embedder) and 740 MB (the verifier). Check: `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A2's command, per pin.
  - Assumption: A10 — a GitHub Release asset must be under 2 GiB (read on 2026-10-20). Check: `curl -sL https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases | command grep -oE 'must be under 2 GiB'`. With A9, this is why the weights are not in the installer (§ Options considered D).
  - Assumption: A11 — Hugging Face answers a `resolve` URL for a large file with a redirect to a CDN host (`us.aws.cdn.hf.co` observed on 2026-10-20). Check: `curl -sIL -r 0-0 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf' | command grep -i '^location'`.
  - Assumption: A12 — `node-llama-cpp@3.22.2`'s `createModelDownloader` verifies no digest (read on 2026-10-20). Check: `command grep -rlE -i 'sha256|xxhash|checksum' package/dist` in A4's unpacked tarball returns nothing.
  - Assumption: A13 — the provisional OCR default's English language data is roughly 11 MB compressed, and a pin changed to another of `docs/adr/0006-image-only-slides.md` § Decision (d)'s candidates is small enough to ship the same way. Check: `curl -sI https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz | command grep -i content-length`, and at a re-pin the new pin's file sizes.
  - Assumption: A14 — the server's default data directory on Windows is under `%APPDATA%`, the per-user application-data folder that a per-user install ((c)) can write without administrator rights. Check: `apps/server/src/data-directory.test.ts`'s "defaults to the OS app-data folder on each platform", then a course file created in the VM landing under `%APPDATA%`.
  - Assumption: A15 — `electron-builder` packages an app from this pnpm workspace's symlinked `node_modules` without `node-linker=hoisted`. Check: #162's first build on the runner.
  - Assumption: A16 — the installed app opens no connection but loopback and (e)'s hosts: a packet capture (`pktmon`) in the VM across install, first launch and one session lists loopback, `huggingface.co` and A11's hosts during the download, and nothing after. Check: #164.
  - Assumption: A17 — `node-llama-cpp` selects its fastest matching CPU-variant library on the target laptop's CPU, which the VM cannot show: under emulation the app sees an emulated CPU, not the laptop's (#7's first comment). Check: `node-llama-cpp`'s debug log on the laptop (#164), beside `docs/adr/0003-model-roles-and-backends.md` § Decision (k) A13.
  - Assumption: A18 — an unsigned installer downloaded from a browser shows SmartScreen's dialog, cleared in two clicks, as #7's first comment researched. Check: the VM install (#164).
  - Assumption: A19 — the cheapest signing service #7's first comment researched, Azure Trusted Signing, was available to individuals only in the US and Canada as of late 2025. Check: re-read when a (h) trigger fires.
- **(m) What each ticket delivers.**
  - This ADR delivers the decision.
  - #161: the shell ((a), (b)), the downloader ((e), (f)) with its named test, writing into (j)'s `models/`, and the shell's content security policy under `docs/standards/security.md`.
  - #162: the release workflow and the installer ((c), (g), (h), (i)), (d)'s smoke, and the install guide; it checks A6–A8 and A15.
  - #163: the `node-llama-cpp` generator adapter, loading from `models/`, never through A12's downloader; and the owner's allow-list decision for `node-llama-cpp` (`docs/adr/0003-model-roles-and-backends.md` § Decision (l)).
  - #164: (k)'s laptop run and VM checklist, and A16–A18; it depends on #47 and #69.
  - #108: the OCR adapter's local paths.
  - #20: developer-mode weights.
  - #165: the egress census over first-party sources (D6), a gate change the owner decides.
- **(n) Restatement ledger**, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes, following `docs/adr/0004-storage.md` § Decision (h)'s precedent. Owned here:
  - the shell and its network surface ((a));
  - the installer and the release shape ((c), (i));
  - the no-rebuild rule ((d));
  - the download mechanism and its claim ((e), (f));
  - the OCR-in-installer rule ((g));
  - the signing deferral ((h));
  - the data-folder layout ((j));
  - the testing surfaces and the release gate ((k)).

  Sweep: `git grep -n -iE '0007-desktop-packaging|ADR 0007|(^|[^0-9a-z])#7([^0-9]|$)|(^|[^a-z])(electron|nsis|tauri|smartscreen|electron-builder|hugging ?face)([^a-z]|$)|code.?sign|first.launch|installer|only outbound|desktop shell|app data|auto-?updat' -- ':/' ':/!pnpm-lock.yaml' ':/!docs/adr/0007-desktop-packaging.md' ':/!.claude/scripts/'`. Its first three arms are the citation arms, and `(^|[^0-9a-z])#7` stands in for a word boundary (`docs/standards/evidence.md`, #40). `.claude/scripts/` is excluded because its hits use the same words in another sense: the shellcheck and actionlint installers, and test fixtures named `0007-*.md`. Run at `fe6f63a` on 2026-10-20 for branch `7-adr-desktop-packaging`, with this change's edits in the working tree. Its hits, by file:

  - Carriers citing this file by path: `docs/plan.md` §3.6's two bullets, pointers that replaced the desktop claim set and the Tauri comparison in the same change; §7 item 7 (the scope line); §9 q3 and q4, marked answered.
  - Carriers not citing this file: `docs/plan.md` §5's `desktop/` layout row; §8 M5 (a milestone scope line); and the status line and §0, which record what the owner accepted on 2026-10-13. All four are consistent with (a), (c) and (e).
  - Index row: `docs/adr/README.md` § Index (this ADR's row, whose title states the shell, the installer, the download and the OCR rule).
  - Immutable ADRs that defer to this one by number or use "installer" for the deployable: `docs/adr/0002-deployables.md` § Decision (a), (b), its ledger, § Options considered C and D, and § Consequences; `docs/adr/0003-model-roles-and-backends.md` § Context, § Decision (i), (l) and (m), and § Options considered H; `docs/adr/0004-storage.md` § Decision (a) and (c), § Options considered A and D, and § Consequences; `docs/adr/0006-image-only-slides.md` § Consequences, which hands the OCR files' shipping here, answered by (g). 0004's "builds for the desktop shell" is answered by (d), with D3 stated above.
  - Non-carriers: `docs/plan.md` §7 item 2 (0002's scope line); ADR 0003's and ADR 0006's Hugging Face check commands and model rows; `packages/gateway`'s `@huggingface/tokenizers` dependency and its comments on the Hugging Face repository layout; `.github/workflows/ci.yml`'s comment on its tool installer.
  - Ledger entry: `.claude/ledgers/model-pin-shape.ledger`'s `carrier:` line naming this file, for D5's and (e)'s digest sentences, which follow ADR 0003 § Decision (e) as amended on 2026-10-20 (#124).
  - Past-tense record: `docs/review-feedback.md`'s entries for #3 and #6, and this ADR's entry for #7.

## Options considered

**A. Electron, with the server in the main process (chosen).** Its downsides are genuine and accepted:

- a Chromium per app, and its memory, on a laptop that has little to spare;
- Electron sits outside the egress gate's census ((a));
- a large installer;
- every runtime upgrade is an app release (`docs/adr/0002-deployables.md` § Consequences).

**B. Tauri.** A smaller shell on the system webview. Rejected: the server is Node and both model runtimes are Node addons, so Tauri would have to run a Node runtime as a sidecar process. That is two runtimes, one of them outside the shell's management, and a second process for `docs/adr/0002-deployables.md` § Decision (b)'s in-process server.

**C. No shell: the server as a background service, used from the user's own browser.** Rejected: no installer story for a non-technical user, no lifecycle (start, stop, quit), and the browser's own extensions and sync share a window with the course.

**D. Weights inside the installer.** No first-launch download, and a fully offline install. Rejected: one release asset cannot hold the generator (A9, A10), and every re-pin would re-ship everything.

**E. Download during install**, from an NSIS page or with `electron-builder`'s web installer. Rejected: the digests live in `packages/gateway`'s pins, which the installer script cannot read, and the web installer fetches app packages, not model files.

**F. `node-llama-cpp`'s `createModelDownloader`.** Resume and parallel downloads for free. Rejected as the mechanism: it verifies no digest (A12), and it serves GGUF files while three of the four roles' artefacts are ONNX.

**G. Signing now**, with a certificate or a signing service. No SmartScreen dialog. Rejected by owner decision 2026-10-13, at the costs #7's first comment researched.

**H. An auto-updater.** Rejected for `docs/adr/0002-deployables.md` § Options considered C's reason, and because an updater is a second outbound connection.

**I. MSI, MSIX or Squirrel.** Rejected: NSIS is `electron-builder`'s default (A6) with a per-user one-click path, and MSIX needs a certificate.

**J. OCR data downloaded with the weights.** One download path for every model file. Rejected for (g)'s reason.

## Consequences

**Easier.**

- One installer, built by CI, with nothing compiled on the runner or the laptop.
- A re-pin is a download, not a release.
- Every outbound byte of the installed app goes through one first-party module.

**Harder.**

- The VM proves the installer and the UI, but not x64 kernel selection or performance (A17), so the laptop is a gate, not a convenience.
- A first launch downloads several GB (A9) over the user's own connection before the app is usable.
- Electron's installer size and memory.
- An unsigned installer's dialog on every fresh download.

**Explicitly accepted.**

- The installer is unsigned.
- No updater.
- The target-class run blocks the first release ((k)).
- Until #165, the egress gate cannot see first-party network code (D6).

**What would make us revisit.**

- A second user (signing, (h)).
- An addon failing (d)'s smoke, which turns the fallback into the decision.
- A pinned artefact Hugging Face stops serving.
- The owner adopting #26's relocation, which moves the generator's weights off the laptop.
