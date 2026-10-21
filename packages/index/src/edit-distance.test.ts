import { describe, expect, it } from 'vitest';
import { editDistance } from './edit-distance';

describe('editDistance', () => {
  it('is zero for equal text, and the other length against empty text', () => {
    expect(editDistance('worker', 'worker')).toBe(0);
    expect(editDistance('', 'bee')).toBe(3);
    expect(editDistance('bee', '')).toBe(3);
  });

  it('counts one edit for a substitution, an insertion, a deletion and an adjacent swap', () => {
    expect(editDistance('wirker', 'worker')).toBe(1);
    expect(editDistance('workker', 'worker')).toBe(1);
    expect(editDistance('wrker', 'worker')).toBe(1);
    expect(editDistance('wroker', 'worker')).toBe(1);
    expect(editDistance('workre', 'worker')).toBe(1);
    expect(editDistance('owrker', 'worker')).toBe(1);
  });

  it('counts a swap of letters that are not adjacent as two edits', () => {
    expect(editDistance('werkor', 'worker')).toBe(2);
    expect(editDistance('rowker', 'worker')).toBe(2);
  });

  it('never edits a substring twice, unlike unrestricted Damerau distance', () => {
    expect(editDistance('ca', 'abc')).toBe(3);
  });

  it('measures code points, so a letter outside the BMP is one letter', () => {
    expect(editDistance('a𝔟c', 'abc')).toBe(1);
    expect(editDistance('a𝔟c', 'a𝔠c')).toBe(1);
  });

  it('is symmetric', () => {
    expect(editDistance('foraegrs', 'foragers')).toBe(editDistance('foragers', 'foraegrs'));
    expect(editDistance('drnoes', 'drones')).toBe(1);
  });
});
