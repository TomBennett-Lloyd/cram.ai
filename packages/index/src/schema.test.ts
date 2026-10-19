import { describe, expect, it } from 'vitest';
import { classifySchema } from './schema';

describe('classifySchema', () => {
  it('treats an unversioned file as blank only when it holds nothing', () => {
    expect(classifySchema(0, 'empty', 3)).toBe('blank');
    expect(classifySchema(0, 'other', 3)).toBe('foreign');
    expect(classifySchema(0, 'course', 3)).toBe('foreign');
  });

  it('treats a versioned file without the course table as foreign, whatever its version', () => {
    expect(classifySchema(3, 'other', 3)).toBe('foreign');
    expect(classifySchema(9, 'empty', 3)).toBe('foreign');
  });

  it('places a course file against the app version', () => {
    expect(classifySchema(2, 'course', 3)).toBe('older');
    expect(classifySchema(3, 'course', 3)).toBe('current');
    expect(classifySchema(4, 'course', 3)).toBe('newer');
  });
});
