# Typing standards

_Ported from [cumulo](https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`._

**Trigger:** writing or changing TypeScript types; tempted to reach for `any`, a type assertion, or a loosely shaped object.

## Rules

1. **Model the domain, not the transport.** A type describes what a value _is_, not what shape happened to arrive. Meaningful primitives get named types, not bare `string`/`number` passed four layers deep. Where confusion is plausible (IDs, indices with different bases), brand the type so the compiler catches the mistake — and apply the brand to the schema (`.brand<'SlideId'>()`) rather than hand-writing it beside it, because rule 3 owns the type wherever a schema already parses the value.

2. **No `any`, no unchecked assertions.** `as` is only acceptable when narrowing something already proven by a runtime check the compiler can't follow — and that's rare; prefer a type guard the compiler _can_ follow. The linter enforces this (suppression comments are themselves lint errors). If you're fighting the type checker, the type model is wrong: fix the model, don't silence the checker.

3. **Zod schemas are the single source of truth at boundaries.** External data — HTTP bodies, DB rows, parsed files, model-backend responses, env vars — is `unknown` until parsed by a schema. Derive the static type with `z.infer<typeof schema>`. Never hand-write a type that duplicates a schema; never trust a cast where a parse belongs.

4. **Discriminated unions over optional-field bags.** If a value has modes, encode them:

   ```ts
   // ❌ what does { answer: undefined, error: undefined, loading: false } mean?
   type Result = { loading: boolean; answer?: Answer; error?: string };

   // ✅ impossible states are unrepresentable
   type Result =
     | { status: 'loading' }
     | { status: 'ready'; answer: Answer }
     | { status: 'failed'; error: AnswerError };
   ```

5. **The strict compiler flags stay on.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are non-negotiable in `tsconfig.base.json`. Code that's awkward under them is usually code with a hidden bug — restructure rather than loosen.

6. **Parameter objects conform to named, reusable types.** A function taking an options or dependencies object declares a named, exported `interface`/`type` — `<Adapter>Deps`, `BackoffSpec` — never a fresh anonymous shape inlined into the signature. Call sites then conform to one nameable contract instead of to a shape that only exists inside one signature, and two functions that want the same deps are visibly the same rather than accidentally alike. Prose rather than lint because "reusable" is the part that matters and no rule can see it.

## Why

This project's domain is full of same-shaped values (a slide's page number vs its index in the parsed deck, a deck id vs a unit id, a marks total vs a marks awarded). Structural typing makes these silently interchangeable unless we name and brand them. Descriptive types are also the cheapest documentation we have — every agent (and human reviewer) reads them before any prose.
