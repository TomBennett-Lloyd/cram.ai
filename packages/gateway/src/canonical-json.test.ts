import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('gives equal text for equal content whatever the key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [{ x: 2, y: 1 }] }, b: 1 }),
    );
  });

  it('writes arrays as arrays and sorts keys inside them', () => {
    expect(canonicalJson([1, { b: 1, a: 2 }])).toBe('[1,{"a":2,"b":1}]');
  });

  it('keeps array order, which is content', () => {
    expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
  });
});
