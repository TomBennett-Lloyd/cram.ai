import { describe, expect, it } from 'vitest';
import { courseIdFromName } from './course-name';

describe('courseIdFromName', () => {
  it('lowercases a name and joins its words with single hyphens', () => {
    expect(courseIdFromName('Biology 101')).toBe('biology-101');
    expect(courseIdFromName('  Cell   Bio: Part II!  ')).toBe('cell-bio-part-ii');
    expect(courseIdFromName('a')).toBe('a');
  });

  it('cuts a long name to what the server files, with no trailing hyphen', () => {
    expect(courseIdFromName(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63));
    expect(courseIdFromName('b'.repeat(70))).toBe('b'.repeat(64));
  });

  it('refuses a name with no letter or digit, and a reserved device name', () => {
    for (const name of ['', '   ', '---', '!!', 'CON', 'lpt1'])
      expect(courseIdFromName(name)).toBeUndefined();
  });
});
