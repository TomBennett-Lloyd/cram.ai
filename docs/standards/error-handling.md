# Error-handling standards

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

**Trigger:** writing a `catch`, calling anything that can fail (network, the model backend, file parsing, the database), or deciding what a failure should do.

## Rules

1. **Expected failures are values; unexpected failures are exceptions.** Outcomes that are part of a function's domain — deck not found, no slide supports the claim, model backend rate-limited — are returned as discriminated unions the caller must handle. `throw` is reserved for bugs and violated invariants, and those propagate to the process/request boundary — never caught mid-stack to "keep going".

   **Who classifies, and where: the module that owns the input.** A failure reachable from inputs the module's own published schemas and types accept is an expected failure and must be a value — however deep inside the module it is detected, and however rare the input. Only states unreachable by construction throw: a violated invariant, wiring that could not have been assembled correctly. The test is "could a caller hand me this without breaking my published contract?", not "does this feel exceptional?" — the second question is answered by whoever happens to be holding the failure, which is why it produces a different verdict in every module.

   **The tiebreak is blame: who does the operator need to call?** When a failure can be argued either way, decide it by whose fault it is, and make the failure's type and message name that party. A caller bug reported as an infrastructure error sends someone to the wrong log; a real outage reported as a caller bug sends them to the wrong repository. Classification exists to route the investigation, not to satisfy a taxonomy.

   **Process-boundary corollary: the transport may still be a throw.** Where the platform gives one failure channel — a process exit status, a job runner's failed state — an expected failure may be re-raised as a throw _at that boundary_, as the verdict rather than as a bug report. Classification governs the blame the message carries, not the mechanism that carries it. cumulo#136 is where this was earned: a batch handler whose items failed as values re-raised one summary throw into the only channel its alarm could see, with per-item blame already in the outcome log.

2. **Never swallow.** Every `catch` either (a) converts to a typed expected-failure value, (b) adds context and rethrows, or (c) is the top-level boundary handler that logs and responds. A `catch` that logs-and-continues, or an empty `catch`, is a review blocker.

   **Wrapper-boundary corollary: preconditions run before the `try`, not inside it.** A `catch` that translates everything within it into an infrastructure type will relabel any caller bug that wanders in, so precondition and invariant checks go ahead of it. In cumulo#166 one storage write path hoisted its checks to the loop head, outside its wrapping `try`, and an unusable retry policy there surfaced as the programming error it is; the batch paths reached the identical check _inside_ the wrapper, and the same bad wiring surfaced as a storage error blaming the database. Same input, opposite verdict, decided by which side of a wrapper found it — so the wrapper, not the package, is the boundary that has to classify.

3. **External calls state their failure policy at the call site.** Timeout, retry count/backoff, and what happens on final failure are visible where the call is made (or in the adapter's config), not implicit in library defaults. A rate-limited dependency gets backoff on 429, never a hot retry.

4. **Errors carry context.** What operation, on what entity (deck id, slide number, request id), caused by what. Structured logging at boundaries; no bare `console.log` in library code.

5. **Degrade honestly in the product.** A result computed from partial input says so, in the UI. Where the wire contract has no field to label a partial with, the honest answer is a refusal rather than a short 200. Silently pretending completeness corrupts exactly the grounding guarantee this project is about.

## Worked examples

Two cumulo paths were classified by where the failure was detected rather than by whose fault it was, and were re-decided under rules 1 and 2 (cumulo#100):

- **An implausible output built from schema-valid inputs is a value.** A builder validated its output against the published schema, and the bounds it could fail were reachable from inputs the package's published types accepted. So implausibility was a domain outcome, returned as `{ status: 'implausible', … }`, and each caller picked its own policy from the same value: the live consumer failed the record and let its boundary alarm (rule 1's process-boundary corollary), a batch replay skipped the item and reported it in the run's coverage rather than aborting.
- **A duplicate key or an unusable retry policy blames the caller, before anything is sent.** The storage package refused both ahead of its wrapper on every batch entry point, with a plain `Error` naming the operation and the offending key — not a storage error, which would point the operator at the database, and not a last-wins dedupe, which would swallow the bug outright (rule 2). A write is not a set question; only the read path dedupes.

## Why

Every answer this product gives is trusted only because it is grounded. An error swallowed while parsing a slide becomes a missing citation or a confidently wrong answer downstream, and that costs hours to trace back to its cause.
