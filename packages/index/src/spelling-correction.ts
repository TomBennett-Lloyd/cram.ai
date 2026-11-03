import { codePoints, editDistance } from './edit-distance';
import { INDEX_WORDS } from './index-words';

/** The most edits a correction makes, however long the token. Carriers: `.claude/ledgers/spelling-max-edits.ledger`. */
export const MAX_EDITS = 2;

/** Letters a token needs for each edit, so also the shortest token corrected. Carriers: `.claude/ledgers/spelling-min-term-length.ledger`. */
export const MIN_TERM_LENGTH = 4;

export interface CourseTerm {
  readonly term: string;
  readonly documents: number;
}

export interface Lexicon {
  isCourseTerm(token: string): boolean;
  isCommonWord(token: string): boolean;
  termsOfLength(min: number, max: number): readonly CourseTerm[];
  isInflection(typed: string, term: string): boolean;
}

export type SpellingCorrection =
  { readonly status: 'as-typed' } | { readonly status: 'corrected'; readonly searched: string };

const LETTERS = /^[\p{L}\p{M}]+$/u;

const allowedEdits = (token: string): number =>
  Math.min(MAX_EDITS, Math.floor(codePoints(token).length / MIN_TERM_LENGTH));

const nearer = (
  a: CourseTerm & { readonly distance: number },
  b: CourseTerm & { readonly distance: number },
): number => a.distance - b.distance || b.documents - a.documents || (a.term < b.term ? -1 : 1);

/** The course term `token` is a typo of, or `undefined` to leave it as typed. */
const correctionOf = (token: string, lexicon: Lexicon): string | undefined => {
  const edits = allowedEdits(token);
  if (edits === 0 || !LETTERS.test(token)) return undefined;
  if (lexicon.isCourseTerm(token) || lexicon.isCommonWord(token)) return undefined;
  const { length } = codePoints(token);
  const near = lexicon
    .termsOfLength(length - edits, length + edits)
    .filter(({ term }) => LETTERS.test(term))
    .map((candidate) => ({ ...candidate, distance: editDistance(token, candidate.term) }))
    .filter(({ distance }) => distance <= edits);
  if (near.some(({ term }) => lexicon.isInflection(token, term))) return undefined;
  return near.sort(nearer)[0]?.term;
};

const inCaseOf = (typed: string, term: string): string => {
  if (typed === typed.toUpperCase()) return term.toUpperCase();
  const [typedFirst = ''] = codePoints(typed);
  if (typedFirst === typedFirst.toLowerCase()) return term;
  const [first = '', ...rest] = codePoints(term);
  return first.toUpperCase() + rest.join('');
};

export const correctSpelling = (text: string, lexicon: Lexicon): SpellingCorrection => {
  let searched = '';
  let from = 0;
  for (const { typed, start, term: indexed } of INDEX_WORDS.words(text)) {
    const term = correctionOf(indexed, lexicon);
    if (term === undefined) continue;
    searched += text.slice(from, start) + inCaseOf(typed, term);
    from = start + typed.length;
  }
  return from > 0
    ? { status: 'corrected', searched: searched + text.slice(from) }
    : { status: 'as-typed' };
};
