import { describe, expect, it } from 'vitest';
import { codePoints } from './edit-distance';
import {
  correctSpelling,
  type CourseTerm,
  type Lexicon,
  MAX_EDITS,
  MIN_TERM_LENGTH,
} from './spelling-correction';

/** A course's terms by chunk count, its common words, and the inflection pairs a stemmer would join. */
class FixtureLexicon implements Lexicon {
  readonly #terms: readonly CourseTerm[];
  readonly #common: ReadonlySet<string>;
  readonly #inflections: ReadonlySet<string>;

  constructor(
    terms: Readonly<Record<string, number>>,
    common: readonly string[] = [],
    inflections: readonly (readonly [string, string])[] = [],
  ) {
    this.#terms = Object.entries(terms).map(([term, documents]) => ({ term, documents }));
    this.#common = new Set(common);
    this.#inflections = new Set(inflections.map(([typed, term]) => `${typed} ${term}`));
  }

  isCourseTerm(token: string): boolean {
    return this.#terms.some(({ term }) => term === token);
  }

  isCommonWord(token: string): boolean {
    return this.#common.has(token);
  }

  termsOfLength(min: number, max: number): readonly CourseTerm[] {
    return this.#terms.filter(
      ({ term }) => codePoints(term).length >= min && codePoints(term).length <= max,
    );
  }

  isInflection(typed: string, term: string): boolean {
    return this.#inflections.has(`${typed} ${term}`);
  }
}

const searched = (text: string, lexicon: Lexicon): string => {
  const result = correctSpelling(text, lexicon);
  return result.status === 'corrected' ? result.searched : `as typed: ${text}`;
};

const BEES = new FixtureLexicon({ worker: 3, foragers: 2, swarm: 1, are: 9, bees: 9 });

describe('correctSpelling', () => {
  it('replaces a substitution, a transposition and a missing letter with the course term', () => {
    expect(searched('Are wirker bees male?', BEES)).toBe('Are worker bees male?');
    expect(searched('Are wroker bees male?', BEES)).toBe('Are worker bees male?');
    expect(searched('Are wrker bees male?', BEES)).toBe('Are worker bees male?');
    expect(searched('an extra letter: workker', BEES)).toBe('an extra letter: worker');
  });

  it('leaves text with nothing to correct as typed', () => {
    expect(correctSpelling('Are worker bees male?', BEES)).toEqual({ status: 'as-typed' });
    expect(correctSpelling('', BEES)).toEqual({ status: 'as-typed' });
    expect(correctSpelling('?! --', BEES)).toEqual({ status: 'as-typed' });
  });

  it('corrects every occurrence, wherever it sits, and keeps the text around it', () => {
    expect(searched('wroker', BEES)).toBe('worker');
    expect(searched('wroker? "wroker", (wroker)!', BEES)).toBe('worker? "worker", (worker)!');
    expect(searched('Wroker bees and the swamr', BEES)).toBe('Worker bees and the swarm');
  });

  it('keeps the case the student typed the token in', () => {
    expect(searched('wroker', BEES)).toBe('worker');
    expect(searched('Wroker', BEES)).toBe('Worker');
    expect(searched('WROKER', BEES)).toBe('WORKER');
    expect(searched('wROKER', BEES)).toBe('worker');
  });

  it('allows one edit per MIN_TERM_LENGTH letters of the typed token', () => {
    expect(MIN_TERM_LENGTH).toBe(4);
    const lexicon = new FixtureLexicon({ abcd: 1, abcdefgh: 1, abcdefghijkl: 1 });
    expect(searched('abce', lexicon)).toBe('abcd');
    expect(searched('abxdefgy', lexicon)).toBe('abcdefgh');
    expect(searched('abxdefg', lexicon)).toBe('as typed: abxdefg');
    expect(searched('abxdefxh', lexicon)).toBe('abcdefgh');
    expect(searched('abcdexgh', new FixtureLexicon({ abcdefgh: 1 }))).toBe('abcdefgh');
  });

  it('never corrects a token shorter than MIN_TERM_LENGTH', () => {
    const lexicon = new FixtureLexicon({ abc: 1, hive: 1 });
    expect(searched('abx', lexicon)).toBe('as typed: abx');
    expect(searched('hve', lexicon)).toBe('as typed: hve');
  });

  it('caps the edits at MAX_EDITS however long the token', () => {
    expect(MAX_EDITS).toBe(2);
    const lexicon = new FixtureLexicon({ abcdefghijklmnop: 1 });
    expect(searched('xbcdefghijklmnoy', lexicon)).toBe('abcdefghijklmnop');
    expect(searched('xbcdefxhijklmnoy', lexicon)).toBe('as typed: xbcdefxhijklmnoy');
  });

  it('reaches terms longer and shorter than the token by the edits allowed', () => {
    const lexicon = new FixtureLexicon({ abcdefghij: 1 });
    expect(searched('abcdefgh', lexicon)).toBe('abcdefghij');
    expect(searched('abcdefghijkl', lexicon)).toBe('abcdefghij');
    expect(searched('abcdefg', lexicon)).toBe('as typed: abcdefg');
    expect(searched('abcdefghijklm', lexicon)).toBe('as typed: abcdefghijklm');
  });

  it('counts letters by code point, so a short token outside the BMP stays as typed', () => {
    expect(searched('𝔞𝔟𝔵', new FixtureLexicon({ '𝔞𝔟𝔠': 1 }))).toBe('as typed: 𝔞𝔟𝔵');
    expect(searched('𝔞𝔟𝔠𝔵', new FixtureLexicon({ '𝔞𝔟𝔠𝔡': 1 }))).toBe('𝔞𝔟𝔠𝔡');
  });

  it('leaves a course term, a common word and a token holding a digit as typed', () => {
    const lexicon = new FixtureLexicon({ hive: 1, lone: 1, '1500': 1, ab12: 1 }, ['long']);
    expect(searched('hive', lexicon)).toBe('as typed: hive');
    expect(searched('long', lexicon)).toBe('as typed: long');
    expect(searched('1550', lexicon)).toBe('as typed: 1550');
    expect(searched('ab13', lexicon)).toBe('as typed: ab13');
    const abcd = new FixtureLexicon({ abcd: 1 });
    expect(searched('abc2', abcd)).toBe('as typed: abc2');
    expect(searched('ab2d', abcd)).toBe('as typed: ab2d');
    expect(searched('2bcd', abcd)).toBe('as typed: 2bcd');
  });

  it('corrects a token, and into a term, that holds a combining mark', () => {
    expect(searched('cafe\u0301x', new FixtureLexicon({ cafex: 1 }))).toBe('cafex');
    expect(searched('cafey', new FixtureLexicon({ 'cafe\u0301': 1 }))).toBe('cafe\u0301');
  });

  it('never corrects a token into a term holding a digit', () => {
    expect(searched('abcd', new FixtureLexicon({ abc1: 1 }))).toBe('as typed: abcd');
    expect(searched('abcd', new FixtureLexicon({ abc1: 5, abce: 1 }))).toBe('abce');
  });

  it('counts a course term that is an inflection of the token as the typed word', () => {
    const lexicon = new FixtureLexicon({ paints: 4, saint: 9 }, [], [['paint', 'paints']]);
    expect(searched('paint', lexicon)).toBe('as typed: paint');
    const nearer = new FixtureLexicon({ paints: 1, pain: 9 }, [], [['paint', 'paints']]);
    expect(searched('paint', nearer)).toBe('as typed: paint');
    expect(searched('paint', new FixtureLexicon({ paints: 4 }))).toBe('paints');
  });

  it('prefers the nearest term, then the one in more chunks, then the first in code-unit order', () => {
    expect(searched('abcdefxx', new FixtureLexicon({ abcdefgx: 1, abcdefgh: 9 }))).toBe('abcdefgx');
    expect(searched('abcdefgz', new FixtureLexicon({ abcdefgh: 1, abcdefgy: 9 }))).toBe('abcdefgy');
    expect(searched('abcdefgz', new FixtureLexicon({ abcdefgy: 9, abcdefgh: 1 }))).toBe('abcdefgy');
    expect(searched('abcdefgz', new FixtureLexicon({ abcdefgh: 9, abcdefgy: 1 }))).toBe('abcdefgh');
    expect(searched('abcdefgz', new FixtureLexicon({ abcdefgy: 2, abcdefgh: 2 }))).toBe('abcdefgh');
    expect(searched('abcdefgz', new FixtureLexicon({ abcdefgh: 2, abcdefgy: 2 }))).toBe('abcdefgh');
  });
});
