export type Quotes = readonly [string, ...string[]];

/** All the verifier may see (`docs/adr/0001-grounding-architecture.md` § Decision (d)). */
export interface VerifierInput {
  readonly text: string;
  readonly quotes: Quotes;
}
