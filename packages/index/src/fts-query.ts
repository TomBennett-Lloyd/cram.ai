import { INDEX_WORDS } from './index-words';

/** Student text as an FTS5 `MATCH` that cannot be a syntax error: its distinct index terms, quoted, OR-joined. */
export const ftsMatchExpression = (text: string): string | undefined => {
  const terms = [...new Set(INDEX_WORDS.words(text).map(({ term }) => term))];
  return terms.length === 0 ? undefined : terms.map((term) => `"${term}"`).join(' OR ');
};
