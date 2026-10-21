import { describe, expect, it } from 'vitest';
import { COMMON_WORD_COUNT, COMMON_WORDS } from './common-words';

describe('COMMON_WORDS', () => {
  it('holds COMMON_WORD_COUNT distinct lower-case words', () => {
    expect(COMMON_WORDS).toHaveLength(COMMON_WORD_COUNT);
    expect(new Set(COMMON_WORDS).size).toBe(COMMON_WORDS.length);
    expect(COMMON_WORDS.filter((word) => !/^[a-z]+$/.test(word))).toEqual([]);
  });
});
