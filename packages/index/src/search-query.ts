export interface SearchQuery {
  readonly text: string;
  readonly embedding: Float32Array;
  /** Off by default: references pages would dominate BM25 (#9's sizing comment, #78). */
  readonly includeReferences?: boolean;
  /** On for exam generation only (`docs/standards/grounding.md` rule 10); Ask and notes cite derived text unconfirmed. */
  readonly excludeUnconfirmedDerived?: boolean;
}
