# 0004 — Storage: one SQLite file per course; FTS5 + sqlite-vec; no shared store

- **Status:** proposed
- **Date:** 2026-10-16
- **Issue:** #4

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into cited answers, revision notes and practice exams; the slides are uploaded to one machine, and this ADR decides where on it everything derived from them is kept.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. It answers two of those bullets:

- the one headed "No course content leaves the machine it was uploaded to", which bounds where course data may be stored and what may reach anything outside its store;
- the one headed "The repo never contains real course material", which `.claude/scripts/check-no-course-content.sh` already enforces for the file shape this ADR chooses.

The machine is the one issue #3's target-machine comment describes: a CPU-only laptop with little memory to spare. The store therefore runs inside the one server process (`docs/adr/0002-deployables.md` § Decision (a) and (b)), and nothing decided here may add a second process or runtime.

Three positions were settled by the owner, and this ADR records them rather than reopening them: single-user self-hosted is the product, and the multi-user hosted variant is built "when needed" (2026-10-13); and until that variant exists, no backwards compatibility is owed between app versions (2026-10-16).

The unit of everything the product does is a course: every feature in `docs/plan.md` §3.5 runs inside one course, and none spans two. The decision has to fit what is already laid down: `docs/plan.md` §5 gives `packages/index` the schema and retrieval and `packages/shared` the domain schemas, and `CourseId` in `packages/shared/src/slide-record.ts` already names the course. So the storage unit is chosen to be one that id addresses, with its schema `packages/index`'s and the shapes it holds `packages/shared`'s.

## Decision

- **(a) One SQLite file per course, under the app data directory, and the file is the course.** The file's name carries the course's `CourseId`; the course's title and everything else about it live inside the file. There is no cross-course database, registry or manifest: the list of courses is the data directory's listing of course files. Where the data directory lives is the server's configuration (`docs/plan.md` §3.6; #15), and per-user data directories are `docs/adr/0002-deployables.md` § Decision (e)'s. The file's extension is one `.claude/scripts/check-no-course-content.sh` already refuses to track, so the existing gate refuses a course file with no change to it.
- **(b) What lives in the file: everything derived from or produced for that course, and nothing from any other.** That is: the slide records (`packages/shared/src/slide-record.ts`); the uploaded decks and the rendered slide images they came from, stored inside the file so that a citation to derived text can show the original (`docs/plan.md` §3.1; ADR 0006, #6), deleting the course is still one file, and the rebuild in (d) is always possible; the full-text and vector indexes over the records; topic tags (`docs/plan.md` §3.2), which are metadata (`docs/adr/0001-grounding-architecture.md` § Decision (b)); the style exemplars and the sample paper (`packages/shared/src/style-exemplar.ts`); generated exam papers with their gold answers and rubrics, and the student's attempts and marks (§3.5); and generated notes (§3.5). Generated text is kept as the units it was verified as (`packages/shared/src/unit.ts`, with citations in the shape `packages/shared/src/citation.ts` owns). What lives outside the file is not course data: app settings, downloaded model files (§3.6), and logs — and a log carries no course text, because a course deleted under (e) must leave none behind. Course content reaches no store but its own course's file.
- **(c) The retrieval substrate: FTS5 for BM25 and `sqlite-vec` for embeddings, each queried for its own ranked candidate list, fused by reciprocal rank fusion in TypeScript — in the pure core (`docs/standards/architecture.md` rule 3) — not in SQL.** The driver is `better-sqlite3`, which runs in-process and synchronously; that is what makes the store part of the one server process (`docs/adr/0002-deployables.md` § Decision (a)). Embeddings are produced through the model gateway's embedder role (`docs/plan.md` §3.2; ADR 0003, #3). The embedding model, and therefore the vector dimension, is ADR 0003's; the file records which embedder produced its vectors, so that a course indexed under one embedder is re-embedded under another rather than searched — the "re-index one file" of `docs/adr/0001-grounding-architecture.md` § Options considered. The rerank after fusion is #11's to build, and its model is ADR 0003's. FTS5 ships in `better-sqlite3`'s bundled build; two things are assumptions until they are proven: that `sqlite-vec` loads into a `better-sqlite3` connection on the target platform, whose first mechanical proof, for FTS5 and `sqlite-vec` both, is #11's named test — this ADR decides the substrate, and #11 demonstrates it — and that both native modules build for the desktop shell, which is ADR 0007's (#7) to check.
- **(d) Each file carries its own schema version, and no compatibility is owed between app versions before the multi-user variant.** Until the multi-user variant is scheduled (`docs/adr/0002-deployables.md` § Decision (e)) there is no forward-migration obligation and no compatibility guarantee between app versions: when a file's schema version is older than the app's, the app may rebuild the course from the decks stored inside it ((b)), telling the user which derived data — tags, attempts, notes — did not survive. A file newer than the app refuses to open rather than be written to. No rebuild ever touches another course's file. The trigger that un-defers migrations and compatibility is named in the shape (g) uses: the multi-user variant being scheduled, or the first user asking that derived data survive an upgrade. Why: migration code written while the schema changes weekly is bloat that slows iteration, and the decks stored in the file make a rebuild always possible (owner decision 2026-10-16).
- **(e) Deletion is removing the file, and portability is copying it.** Deleting a course removes its file and any transient sidecar files SQLite keeps beside it, which `.claude/scripts/check-no-course-content.sh` also refuses to track. Copying the file while the app is not writing to it moves the course: opened by the same app version on another machine, the copy is that course, with its attempts, notes and tags, and a backup is the same copy. The owner's wording in `docs/plan.md` §3.2 — isolation, backup and deletion are a file operation — is owned here from this ADR on.
- **(f) No shared store for course data, and the bar for a second store.** A second store — a cross-course database, a separate vector store, a file tree beside the course file, a database server — needs evidence from this system, of one of two kinds: a feature that must query across courses (none exists: every feature in `docs/plan.md` §3.5 runs inside one course), or a retrieval latency or course size on the target machine that the single file cannot meet once #11 has measured retrieval against the eval deck. Analogy to larger systems is not evidence. M6's accounts are not course data, so a store for them, when M6 is scheduled, is not a second course store and is decided then (`docs/adr/0002-deployables.md` § Decision (e)); it holds nothing course-derived.
- **(g) At-rest encryption is deferred, and the triggers that un-defer it are named: the multi-user variant being scheduled (M6, `docs/adr/0002-deployables.md` § Decision (e)), or a request from the first user.** It is deferred rather than done because an encrypting SQLite build changes the driver and how the extensions in (c) load, so adopting it is its own ADR when a trigger fires, not a flag. Until then the file lives in a data directory on the user's own single-user machine, and whole-disk encryption offered by the operating system is the user's choice, outside this repo.
- **(h) Restatement ledger**, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes, following `docs/adr/0002-deployables.md` § Decision (g)'s precedent: the per-course file unit in (a), the substrate in (c), the no-migration rule in (d) and the deferral in (g) are owned here. Sweep: `git grep -n -iE '0004-storage|SQLite (file )?per course|local SQLite file|sqlite-vec|reciprocal.rank|FTS5|at-rest encryption|per-course|migrat' -- ':/' ':/!docs/adr/0004-storage.md'`, whose first arm is the citation arm, run at `4840fa2` on 2026-10-16 for branch `4-storage`. Its hits, by file:

  - Carriers citing this file by path: `README.md` § How it works (the engine and the fusion) and `docs/plan.md` §7 item 4 (the scope line).
  - Carriers not citing this file: `docs/plan.md` §3's diagram (the `index (SQLite per course)` label, an illustration that cannot cite) and §5's `index/` layout row; `.gitignore`'s course-content comment ("per-course indexes").
  - Cites by path: `docs/plan.md` §3.2's first bullet, a pointer to this ADR that replaced the unit, the substrate and the file-operation wording in the same change.
  - Index row: `docs/adr/README.md` § Index (this ADR's row, whose title states the unit and the substrate).
  - Non-carriers: `docs/standards/architecture.md` rule 9 and `.claude/scripts/harness-lib.test.sh`, where the `migrat` arm returns ledgers and test harnesses being migrated, not course files.
  - Past-tense record: `docs/review-feedback.md`'s two entries for #4 (the plan feedback that shaped (d), and the pre-label entry), each naming this file by path.
  - Outside the sweep, left standing: `.claude/scripts/check-no-course-content.sh`, the executable carrier of (a)'s extension claim, whose banned set is governed by the ledger its header names; and `docs/plan.md` §8 M1 ("SQLite index; hybrid retrieval"), a milestone scope line.

## Options considered

**A. One SQLite file per course, FTS5 + `sqlite-vec`, reciprocal rank fusion in code (chosen).** Its downsides are genuine and accepted:

- Two native modules to ship, and to build for the desktop shell (ADR 0007, #7).
- `sqlite-vec` has not reached a stable release line as of this ADR's date.
- `sqlite-vec`'s nearest-neighbour search scans the course's vectors, so retrieval cost grows with course size. That is acceptable because a course is thousands of slides at most, never millions, and that growth is what (f)'s measurement watches.
- Fusion in code pulls both candidate lists into the server process rather than ranking inside the database.
- A cross-course question is impossible by construction.
- The decks stored inside the file make it grow with the course, so a copy is as large as the course.
- A schema bump before (d)'s trigger fires may cost the user derived data.

**B. One shared SQLite database for all courses.** Rejected: deleting a course becomes a cascading delete that has to be right, moving one becomes an export, one corrupt file loses every course, and the only gain is a cross-course query the product does not have.

**C. A separate vector store** — a dedicated vector-search process, or an index file beside the course file. Rejected: the first is a second process on the machine #3's comment describes, the second is a second file that breaks (e), and neither has evidence at course scale behind it.

**D. A database server.** Rejected for the installed app: a second runtime installed for a non-technical user, and a process the desktop shell would have to manage, beside the one third-party runtime `docs/adr/0002-deployables.md` § Decision (c) places outside the count. M6 may revisit it under (f).

**E. Plain files plus an in-memory index rebuilt at launch.** Rejected: the indexes would be rebuilt on every start on a CPU-only laptop and held in memory it has little of, and attempts and notes would need a store of their own anyway.

**F. Forward migrations from the first schema.** Rejected by owner decision 2026-10-16: code that carries data across weekly schema changes while nothing is stable is bloat, and the decks stored in the file make a rebuild the cheaper path until (d)'s trigger fires. Its cost is the one A accepts: derived data may not survive a schema bump.

## Consequences

**Easier.** Deleting, moving and backing up a course is a file operation. #9, #10, #11 and #15 plan against a fixed unit. The gate that keeps course files out of the repository already exists. Fusion sits in the pure core with the rest of `docs/standards/architecture.md` rule 3's functions, so its tests, like the fake-gateway tests, need no database. No migration code is written before it is needed.

**Harder.** The installer carries two native modules. Until (d)'s trigger fires, a schema bump may rebuild a course from its stored decks, and derived data may not survive. A large deck makes a large file.

**Explicitly accepted.** At-rest encryption is deferred, with named triggers. `sqlite-vec`'s youth. No cross-course features. No compatibility guarantee between app versions before the multi-user variant.

**What would make us revisit.** Either trigger in (g); the trigger in (d); the evidence (f) asks for; or `sqlite-vec` or FTS5 failing to load on the target platform in #11's test, which would reopen (c) and not (a).
