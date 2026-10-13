# Testing standards

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

**Trigger:** writing or modifying tests; finishing a change and deciding what to test; fixing a bug.

## Rules

1. **Test behaviour through public surfaces.** Call the module's exported API; assert on outcomes, not internals. A test that breaks under a refactor that preserves behaviour is a bad test.

2. **The pure core gets dense, cheap tests.** Chunking, citation resolution, rubric arithmetic and grading (see `architecture.md` rule 3) are pure — test them exhaustively with plain inputs/outputs and a fake model gateway, including domain edge cases: an empty deck, a single-slide deck, a slide with no extractable text, a claim no slide supports, a citation pointing past the last slide, a rubric whose marks do not sum.

3. **Adapters get thin integration tests; don't unit-test mocks.** A test that mocks a client library and asserts the mock was called proves nothing. Test adapters against contracts (recorded/fixture responses — synthetic fixtures only, never real course content) and keep the logic they wrap in the pure core.

4. **Every bug fix lands with a regression test** that fails on the pre-fix code. No exceptions — this is the cheapest ratchet we have.

5. **Tests are code — standards apply.** Typed (no `any` in fixtures), named for the behaviour they prove (`refuses a sentence whose cited slide does not contain its claim`), no copy-paste walls; use builders/factories for fixtures. No snapshot tests for logic (acceptable for genuinely visual output only).

6. **Vitest, colocated.** `*.test.ts` next to the source it tests. `pnpm test` runs everything; a chunk isn't DONE until its tests pass.

7. **If a test turns a guard off to reach its target, another test must run the production default.** Neutering a knob — env var, feature flag, injected clock, retry limit, rate limiter — is often the only way to make a path reachable. But when _every_ test on a path disables the same knob, the suite proves that path works in a configuration nobody runs, and the default is untested. cumulo#42 shipped a reaper that could never reap at its default setting: every reaping test forced the guard to `0`, and the one test that left it on asserted only the refusal it always makes. Mutation testing did not catch it — mutation coverage proves your assertions bite, not that you asserted the right thing in the configuration that ships.

8. **A mutant is transient — revert it, never repair it.** Mutation testing (breaking production code on purpose to prove a test bites) dirties the tree deliberately. The whole loop is: apply the mutant, run the one test file, put the source back by targeted edit — the inverse of the edit you made. Do not revert with `git restore` or `git checkout <path>`: they discard every uncommitted change in that file, not only the mutant, and on cumulo#91 that swallowed work in progress alongside it. If the inverse edit is awkward, copy the file aside first and restore from the copy. The PostToolUse lint hook will often flag the mutant — an unused binding, a now-unreachable branch — but the edit has already landed on disk, so that red is noise, not a blocker. Do not edit the mutant to satisfy it, add a suppression, or disable the hook for the run. A mutant must never survive into a commit, and a mutation run is never a reason to turn a check off.

9. **Forwarding an optional option with `?? <default>` destroys the coverage of the default it restates.** Under `exactOptionalPropertyTypes`, `{ opt: props.opt ?? true }` is the tempting way to pass an optional flag down — and it converts every default-arm test in the suite into an explicit-value test, so the callee's own parameter default is never exercised. Branch on `undefined` and call the shorter overload instead. The failure is invisible to ordinary review and to coverage: prove a parameter default with a mutant on the signature default itself, which on cumulo#178 survived every test until the forwarding helper was fixed.

10. **The jsdom/browser line — decide which lane a criterion belongs to before you write it.** jsdom suites prove component logic through public surfaces and seams; a stand-in component at a rendering-engine line is a seam, not a mock, so rule 3 does not bar it. What jsdom cannot host is not a coverage gap to argue about — it is the other lane's work: anything needing layout, paint, computed style, a worker boot, or a real input modality. Clipped labels, focus-ring visibility, keyboard activation. That list is a routing rule and nothing more — it says where such a criterion belongs, never that a spec for it exists today. Where the lane owns a criterion no spec in it yet asserts, say so beside the code rather than letting the routing imply coverage. That lane is Playwright specs in `apps/web/e2e/`, run against the **built** app — deliberately outside `verify`, for reasons the lane's own CI job comment owns; point at it rather than restating them (`architecture.md` rule 9). Naming split: `*.test.ts` colocated is vitest (rule 6), `e2e/*.spec.ts` is the browser lane. Neither is the other's fallback — a jsdom test reaching for a browser criterion asserts something it cannot see, and a lane spec re-proving logic jsdom already covers is a slow copy of a fast test.

## Why

Coverage that means something is what lets a grounding guarantee be trusted, and reviewers can tell coverage theatre from real tests. Five sharp edge-case tests on citation resolution say more than fifty mock-assertion tests, and the pure-core architecture makes the sharp ones cheap.
