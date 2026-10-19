# eval

The synthetic evaluation course: its deck, golden questions and hand labels. What each is for, and the categories the deck must hold, are `docs/adr/0005-evaluation-as-gate.md` § Decision (a)–(c)'s.

- `eval/decks/hollowmere/` — the deck, one JSON file per lecture, parsed by `DeckLecture` (`eval/src/deck.ts`). The subject is a fictional guild's beekeeping course, self-written for this repository, which deliberately teaches things a general model believes false about bees: the subject class `docs/adr/0001-grounding-architecture.md` § Context names.
- `eval/questions.jsonl` — the golden questions, one `GoldenQuestion` per line (`eval/src/golden-question.ts`, which also exports `inContradictionSet` and `firstForbiddenEntry`).
- `eval/labels/verifier.jsonl` — the verifier hand labels, one `HandLabel` per line (`eval/src/hand-label.ts`).

`auditEvalCourse` (`eval/src/audit.ts`) checks the three against each other, and `eval/src/eval-course.test.ts` runs it over the committed files under `pnpm test`.
