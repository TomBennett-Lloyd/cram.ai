import { describe, expect, it } from 'vitest';
import { classifySchema } from './schema';

describe('classifySchema', () => {
  it('treats an unversioned file as blank only when it holds no tables', () => {
    expect(classifySchema(0, false, 3)).toBe('blank');
    expect(classifySchema(0, true, 3)).toBe('foreign');
  });

  it('places a versioned file against the app version', () => {
    expect(classifySchema(2, true, 3)).toBe('older');
    expect(classifySchema(3, true, 3)).toBe('current');
    expect(classifySchema(4, true, 3)).toBe('newer');
  });
});
