# 0002 — Deployables: one app plus a bundled model runtime; local-first; nothing public

- **Status:** accepted
- **Date:** 2026-10-15
- **Issue:** #2

## Context

cram.ai is a self-hosted tutor that turns one student's lecture slides into cited answers, revision notes and practice exams, on the machine the slides were uploaded to.

This decision is argued from [CLAUDE.md § Hard constraints](../../CLAUDE.md#hard-constraints), which it cites and does not restate. The two bullets it answers are the ones headed "Nothing is publicly reachable", which bounds what the app may bind to, and "No course content leaves the machine it was uploaded to", which bounds where inference may run.

Deployables are worth telling apart only where something drives them differently — a different trigger, load, failure or release cadence. Here there is nothing to split along: everything in this system runs on one trigger, a student's request on the machine the slides are on, and serves that one student. The one component with a lifecycle of its own is the model runtime, which is third-party software with its own versions and releases, not code this repository ships.

The first user is a non-technical Windows user, so the installed app is the primary deployment (owner decision 2026-10-13). Issue #3's target-machine comment describes the machine it installs on: a CPU-only laptop with little memory to spare once the operating system and the app are running, so whatever runs there shares a few cores.

Two positions were settled by the owner on 2026-10-13, and this ADR records them rather than reopening them: single-user self-hosted is the product, and the multi-user hosted variant is built "when needed".

The count below uses one definition. A _deployable_ is an artefact that is built, versioned, released and run on its own. By that definition `packages/*` are libraries that ship inside an artefact, `eval/` is a developer tool run from the checkout (`pnpm eval`), and the CI workflows are build paths; none of them counts. The tension the decision has to reconcile is that `docs/plan.md` §5 lays out three `apps/*` directories, and the count is one.

## Decision

- **(a) Exactly one deployable: the app.** `apps/server`, `apps/web` and `apps/desktop` are three build inputs to one artefact, with one version and one release. The directories separate the server, the SPA and the desktop shell by runtime concern inside that one build, and `docs/standards/architecture.md` rule 1 governs what they may import.
- **(b) Two run modes of the same server, neither a second deployable.** The installed app: the desktop shell runs the Node server in its main process and loads the SPA (`docs/plan.md` §3.6; the packaging specifics are ADR 0007's, #7). Developer mode: `pnpm dev` runs the same server without the shell, serving the SPA (`docs/plan.md` §3.6; §5).
- **(c) The model runtime is outside the count.** It is third-party software, either bundled in-process in the installed app or run as a separate process that the gateway points at over HTTP. The candidates are `docs/plan.md` §3.3's, and which one runs in which mode is ADR 0003's (#3). The gateway interface (`docs/standards/architecture.md` rule 3) is the boundary, so swapping the runtime is a backend change, not a deployable change.
- **(d) Binding, by mode.** The rule is the "Nothing is publicly reachable" bullet cited above; this ADR decides how the one deployable meets it. In both modes of (b) the server listens on the loopback interface only, and the bind address is not a user-facing setting. Outside (e), no file in this repository — config, compose file, workflow or script — defines a listener on a non-loopback interface. The mechanical assertion of the loopback bind is a named test owed by the ticket that creates `apps/server` (#15).
- **(e) The self-hosted multi-user variant** (`docs/plan.md` §8 M6; "when needed", owner decision 2026-10-13) is the server run as a service on a private network, with the model runtime a separate process on that network. Same code, same release: what differs is configuration and the modules §8 M6 lists, local accounts and per-user data directories. It is still one deployable. It is not scheduled, and nothing here schedules it.
- **(f) #26's rented private GPU host is placed, not decided.** It is (c)'s point-at shape, with the runtime on a machine the owner controls behind a private network and the gateway pointing at it; the count is unchanged. Adopting it moves prompt text, retrieved slide spans included, off the laptop to the owner's own server — which the second cited bullet admits, and which #3's target-machine comment and #26 both reserve for the owner's explicit decision. So this ADR neither adopts nor forecloses it; what #26 delivers is its own Deliverable line's.
- **(g) The bar for a second deployable.** A second deployable must demonstrate at least one of independent scaling, independent failure or independent deploy cadence, and _demonstrate_ means with evidence from this system: observed load, an incident that actually happened in that shape, a cadence conflict that has already bitten. Analogy to larger systems is not evidence. This is the form of bar cumulo's `docs/adr/0001-service-boundaries.md` set. The argument goes in a new ADR referencing this one; without it, a new concern is a module inside the app (`docs/standards/architecture.md` rule 4). The default is expected to hold for the background generation pool (`docs/plan.md` §3.3), OCR (§3.1), the topic tagger (§3.2), grading (§3.5), M6's accounts and data directories (§8), and #26's host, which is a runtime relocation and not a deployable at all.

  Restatement ledger, undeclared, in the prose form `docs/standards/architecture.md` rule 9 prescribes: the deployable count and the bar for a second deployable are owned here. Sweep: `git grep -n -iE '0002-deployables|deployables?|(^|[^a-z])one (app|artefact)([^a-z]|$)|independent scaling' -- ':/' ':/!docs/adr/0002-deployables.md'`, whose first arm is the citation arm, run at `15c9b94` on 2026-10-15 for branch `2-deployables`. Its hits, by file:

  - Carriers: `docs/standards/architecture.md` rule 4 (the three criteria) and `docs/plan.md` §7 item 2 (the scope line), each citing this file by path.
  - Paraphrasing carrier, not citing this file: `docs/standards/architecture.md` § Why (the count, in the plural); a `docs/tech-debt.md` entry records it.
  - Cites by path: `docs/plan.md` §3's lead paragraph, a pointer to this ADR that replaced the count and the bar in the same change.
  - Index row: `docs/adr/README.md` § Index (this ADR's row, whose title states the count).
  - Non-carriers: `docs/adr/README.md`'s opening paragraph, and `docs/standards/architecture.md`'s Trigger line and rule 6.
  - Past-tense record: `docs/review-feedback.md`'s `adr-0002-deployables` entry (its heading and the ask citing this file by path).
  - Outside the sweep, left standing: `docs/plan.md` §0, whose "the identical code deploys to a private self-hosted server" paraphrases (e), and `docs/plan.md` §3.6, whose "one runtime, one installer" partly restates (a) and is ADR 0007's surface.

## Options considered

**A. One deployable, the runtime bundled or pointed at (chosen).** Its downsides are genuine and accepted:

- The installed artefact carries the runtime's native binaries, so a runtime upgrade is an app release.
- One process hosts UI serving, ingest, the index and inference, so a background generation job and an interactive Ask compete for the same few cores on the machine #3's comment describes.
- A server fault takes the UI down with it.
- The installed app and developer mode run different backends, so a defect can be specific to one mode.
- M6 inherits a single-tenant design, to which accounts and per-user data have to be added by configuration and modules.

**B. A model-serving service of our own, wrapping the runtime.** Rejected. The runtime is already a process with its own binding; a wrapper adds a wire format for prompts and embeddings that `@cram/shared` does not own (`docs/standards/architecture.md` rule 2), a second install step for a non-technical user, and it has no scaling, failure or cadence evidence behind it. #26's host is the only plausible driver, and that needs nothing of ours beyond the gateway's HTTP adapter.

**C. The desktop shell as its own deployable**, released and updated separately from the server. Rejected: one user has one installer; the shell has no release cadence of its own; a separate updater is a network surface; and it starts counting `apps/*` directories as deployables, which (a) refuses.

**D. The private-network multi-user service as the primary deployment.** Rejected by owner decision 2026-10-13: the first user needs an installer, and accounts and per-user data directories are modules built when needed, under (e).

## Consequences

**Easier.** Every later ticket's "does this need a new service?" has the default answer "a module". ADR 0003 and ADR 0007 plan against a fixed boundary. CI has one artefact to build. The loopback bind is one assertion in one server.

**Harder.** Background generation and Ask contend inside one process. Inference cannot be restarted independently of ingest and the UI. The installer carries the runtime.

**Explicitly accepted.** M6 is unscheduled, and #26 is undecided. Both modes of (b) must stay the same server, or (a) is false.

**What would make us revisit.** Any of (g)'s three criteria shown with evidence from this system — multi-user load the one process cannot absorb, an inference fault that must not take ingest and the UI down with it, a runtime release cadence that forces app releases the user will not tolerate. Or #26 landing on a shape that is not a runtime relocation.
