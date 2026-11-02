import { codePoints, editDistance } from './edit-distance';
import { TERM } from './fts-query';

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
  const terms: string[] = [];
  const searched = text.replace(TERM, (typed) => {
    const term = correctionOf(typed.toLowerCase(), lexicon);
    if (term === undefined) return typed;
    terms.push(term);
    return inCaseOf(typed, term);
  });
  return terms.length > 0 ? { status: 'corrected', searched } : { status: 'as-typed' };
};
