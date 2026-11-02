export const TERM = /[\p{L}\p{M}\p{N}]+/gu;

/** Student text as an FTS5 `MATCH` that cannot be a syntax error: distinct terms, quoted, OR-joined. */
export const ftsMatchExpression = (text: string): string | undefined => {
  const terms = [...new Set(text.toLowerCase().match(TERM) ?? [])];
  return terms.length === 0 ? undefined : terms.map((term) => `"${term}"`).join(' OR ');
};
