# cram.ai 📚

A self-hosted AI tutor that teaches only from your own lecture slides. Upload a course's decks and a few sample exam questions; get practice exams in that style, revision notes compiled across lectures by topic, and answers to your questions — every sentence cited to a slide and checked against it before you see it. If it is not in your slides, the tutor says so.

Built for students whose course material cannot leave their machine, and for subjects where the slides deliberately differ from what a general-purpose model "knows": the slides win, mechanically, because a sentence with no supporting slide never reaches the screen.

## Status

Bootstrapped 2026-10-13. No features yet; the plan is in [`docs/plan.md`](docs/plan.md) and the first decisions are being made as ADRs in [`docs/adr/`](docs/adr/).

## How it works (in one paragraph)

Slides are parsed into one record per slide and indexed in a local SQLite file (full-text and vector search, fused — `docs/adr/0004-storage.md`). Every feature — ask, notes, exams, grading — produces a list of _units_, each carrying citations to specific slides. Citations are resolved mechanically against the index, then a verifier pass checks each unit against its quotes (`docs/standards/grounding.md` rule 4) and drops anything unsupported. Generation and verification run on an open-weight model through a local backend; nothing is sent anywhere. A synthetic evaluation course in `eval/`, including a set of deliberately counter-intuitive "facts", is the regression test that the slides keep winning.

## Local checks

`pnpm verify` is the pre-commit gate and `pnpm verify:full` is what CI runs; see [`CLAUDE.md`](CLAUDE.md) for the rest of the command surface.

## Local model backend

`pnpm models:pull` sets up developer mode's generator on a Mac (`docs/adr/0003-model-roles-and-backends.md` § Decision (c)): the pinned Ollama, serving on loopback only, with the pinned generator GGUF imported as it is. It prints the endpoint and model name for the gateway config. Re-running it changes nothing that already matches the pins.

`pnpm dev` then runs developer mode (`docs/adr/0002-deployables.md` § Decision (b)): the server on loopback, with Vite serving the app in front of it at the URL it prints. Its role config is `developerDefaults` in `apps/server/src/gateway-config.ts`, overridden role by role by the data directory's `GATEWAY_CONFIG_FILE`. The encoder snapshots are read from `developerModelsDirectory`, one directory per pinned repository, and no script fetches them yet (#218).

## How this repo is built

The build process is the other half of the deliverable. Every change starts as a GitHub issue, is planned by an agent into the issue, implemented in an isolated worktree, reviewed by an independent agent pass, and merged by rule; every merged PR gets a retrospective whose only outputs are a workflow fix or a friction-log entry. The agents, skills, hooks and gates live in [`.claude/`](.claude/) and were ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo), where each rule was earned — citations of the form `cumulo#<n>` point there.
