import { describe, expect, it } from 'vitest';
import { pooledVector } from './pooling';

const hidden = Float32Array.from([0, 4, 0, 0, 3, 4, 0, 0, 6, 4, 0, 0]);

describe('pooledVector', () => {
  it('returns the first token as a unit vector under cls pooling', () => {
    expect(pooledVector(hidden, 3, 4, 'cls')).toEqual(Float32Array.from([0, 1, 0, 0]));
  });

  it('returns the mean of every token as a unit vector under mean pooling', () => {
    expect(pooledVector(hidden, 3, 4, 'mean')).toEqual(Float32Array.from([0.6, 0.8, 0, 0]));
  });

  it('returns a zero vector unscaled rather than dividing by zero', () => {
    expect(pooledVector(new Float32Array(4), 2, 2, 'mean')).toEqual(new Float32Array(2));
  });
});
