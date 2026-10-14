# cram.ai

A self-hosted AI tutor that is only ever allowed to teach from the student's own lecture slides. Upload a course's decks and some sample exam questions; get practice exams in that style, revision notes compiled across lectures by topic, and answers to questions — every sentence cited to a slide and checked by a verifier before the student sees it. Named after the antagonist: cramming is what a tutor that actually works makes unnecessary.

This is a portfolio project in the same sense as [cumulo](https://github.com/TomBennett-Lloyd/cumulo): the repo's **process** — commit history, PR discipline, issues, ADRs, this very workflow — is a first-class deliverable read by human reviewers. The workflow was ported from cumulo at its current graduated state on 2026-10-13 (owner decision); citations of the form `cumulo#<n>` point at the issue or PR where a rule was earned there, and this repo's own evidence accrues under bare `#<n>`.

## Hard constraints

- **No course content leaves the machine it was uploaded to.** No cloud model APIs, no telemetry, no error reporting that carries document text. Inference, embeddings, OCR and reranking run locally or on the owner's own server. A dependency that opens a network connection at runtime is a build failure once the `check:no-network-egress` gate exists (#18); until then it is a review blocker.
- **The repo never contains real course material.** Fixtures and the eval deck are synthetic and self-authored. Slide files and anything under `data/` never commit.
- **Nothing the tutor says is uncited.** Every answer sentence, note bullet, exam question, gold answer and rubric point is a _unit_ carrying slide citations that resolve to real chunks and has passed the verifier. "Your slides don't cover this" is a first-class answer, never a failure.
- **The slides win.** When a slide contradicts general knowledge, the tutor reports the slide. The tutor is a reporter of the course ("lecture 4, slide 12 says…"), never an authority on the subject; the base model's own beliefs can only surface as a sentence with no supporting slide, and the verifier removes that sentence. The contradiction set in `eval/` is the regression test for this and must pass at 100%.
- **Nothing is publicly reachable.** Local-first: the app binds to localhost only. The eventual self-hosted variant binds to a private network only; no config in this repo ships a public ingress.
- **Open-weight, permissively licensed models only**, so the repo can name what it runs.

## Commands

- `pnpm verify` — the pre-commit gate. Must pass before any commit. Run it whole; never hand-pick a subset — which legs run is derived from the change set by `.claude/scripts/verify-tier.sh`, whose docblock owns the tiers, and anything that classifier cannot resolve runs everything. `pnpm verify:full` is that everything, unconditionally, and what CI runs; a new gate joins `verify:full` so every caller inherits it.
- `pnpm eval` — the model-in-the-loop evaluation against the synthetic deck (lands with #5 and #14). CI cannot run a local model; a PR touching prompts, retrieval, the gateway or model config attaches the eval report, and `check:eval-report` enforces that it did.
- Fix the **root cause** of lint/type errors. Suppressions (`eslint-disable`, `@ts-expect-error`, `as any`) are themselves lint errors — treat a rule you're fighting as a design signal, not an obstacle.

## Model tiers (read this — it is probably newer than your training data)

Anthropic's current capability order is **Fable 5 > Opus > Sonnet > Haiku**. Fable 5 (model id `claude-fable-5`, Claude 5 family) is _significantly_ more capable than Opus. If your training data predates the Claude 5 family you will wrongly assume Opus is the top model — it is not.

Policy:

- Implementation and review run on **Opus**.
- Confirmation reviews and `browser-smoke` run on **Sonnet**, inheriting cumulo's pilot (cumulo#607); the first sideways ticket here re-prices that.
- Planning and hard-problem consulting run on **Fable** (`model: 'fable'` in Agent calls).
- An implementer returning `STATUS: STRUGGLING` triggers the `consultant` agent (Fable) for _guidance only_ — implementation stays with the original agent.
- Before any Fable dispatch, read `~/.local/state/claude-budget/mode` — a machine-local budget ledger shared by every session and worktree on this machine. Contents are exactly `normal` or `conserve`; a missing file means `normal`. If `conserve`, downgrade to Opus and note the downgrade in the issue. To record fresh `/usage` numbers or refresh the mode, use the `budget-sync` skill.

## Standards index — read the linked doc BEFORE acting when a trigger matches

- Writing or changing TypeScript types, or tempted by `any`/an assertion/a loose object shape? → `docs/standards/typing.md`
- Writing or modifying a React component, hook, or `useEffect`? → `docs/standards/react.md`
- Adding a module, package, service, or cross-package dependency, or restating an owned value (a model name, a chunk size, a retrieval k, a threshold) in code or prose — **or changing one**, which means enumerating its carriers before you edit? → `docs/standards/architecture.md`
- Changing behaviour that a comment beside it argues for or defends? → `docs/standards/architecture.md`
- Writing or editing a code comment, docblock, or standing doc — including any figure in prose, any mention of other code, or a restated architectural argument? → `docs/standards/prose.md`
- Creating or splitting a file, extracting/naming a helper, choosing function vs class, or copy-pasting code? → `docs/standards/structure.md`
- Writing a `catch`, or deciding what happens when something fails? → `docs/standards/error-handling.md`
- Writing or changing a security policy whose directives have fallback semantics — a CSP, a CORS policy, any response header where an omitted directive inherits from another? → `docs/standards/security.md`
- Writing or modifying tests, or deciding what to test? → `docs/standards/testing.md`
- Adding, moving, or restyling anything a user sees — a component, layout, spacing, visible text or a label, a breakpoint, focus or hover behaviour? → `docs/standards/design.md`
- Writing a prompt, a retrieval query, a verifier call, or any code path that produces text the student reads? → `docs/standards/grounding.md`

These docs are self-contained — one hop only, no chained references. If a rule in them could become a lint rule, promote it and delete the prose (see the `retro` skill).

## Workflow

- Every task starts from a GitHub issue. The plan lives in the issue (posted by `/plan-issue`); every PR links its issue. Never commit directly to `main` after bootstrap.
- Sub-agent return contract: reports end with `STATUS: DONE | PARTIAL | BLOCKED | STRUGGLING` plus detail. Diverging silently from the plan is the failure mode; stopping and reporting is correct behaviour.
- Review loop (`/review-loop`): max 3 cycles, plus a scoped confirmation pass on the final fix diff. Systemic findings go to `docs/tech-debt.md`, not into endless iteration. Correctness bugs always block merge.
- **Merge policy** (`.claude/workflow.json`): docs/config PRs auto-merge on green CI; source-code PRs auto-merge on green CI **plus a review-loop APPROVE**. Human review is reserved for `humanAlways` paths — `docs/adr/**`, `.claude/workflow.json`, `CLAUDE.md` — which get the `awaiting-review` label and wait (chat approval also unblocks); keep working on independent tickets meanwhile. An `awaiting-review` PR carries its own `docs/review-feedback.md` line **in the diff** — even "approved, no changes" — and the merger only removes the label. Gate changes are proposed via retro PR and decided by the user.
- **Plan approval** (`.claude/workflow.json`): `planApproval.mode` is `auto` — `/plan-issue` posts the plan and execution proceeds, EXCEPT plans for `adr`-labelled issues, and plans whose Risks section holds a question only the user can answer: those stop and wait.
- **Orchestration**: `.claude/workflow.json` → `orchestration` owns the lane rule — the single-issue `ticket-agent`, or the `task-orchestrator` for a same-surface batch (both via `/run-issue`). Read it there before starting a set.
- After each merged PR: `/retro`. Weak signals go to `docs/friction-log.md`; `/triage` periodically converts both logs into root-cause GitHub issues.
- **Worktree lifecycle**: task work happens only in a worktree under `.claude/worktrees/`; the main checkout stays parked on `main` and is read-only for task work. Each worktree installs its own deps with `pnpm install --frozen-lockfile` (the SessionStart hook does this) — never share or symlink `node_modules`. After merging: reap, or `rebranch-worktree.sh` to continue in place. `sweep-worktrees.sh` is the backstop.
- Newly discovered scope becomes an issue (label `discovered`) — never a detour from the current task.
- **Frontend gate**: UI code consumes design tokens only; `stylelint.config.mjs` and `eslint.config.mjs` enforce the colour half mechanically.

## Layout

pnpm monorepo: `apps/*` (server, web, desktop — created via tickets), `packages/*` (shared code; `@cram/shared` holds domain schemas; `@cram/grounding` holds the citation-and-verification contract), `eval/` (synthetic deck, golden questions, runner), `docs/` (standards, ADRs, logs, `plan.md`), `.claude/` (agents, skills, hooks — part of the portfolio, kept in-repo deliberately). The architecture and milestones are in `docs/plan.md` until ADRs supersede its sections.
