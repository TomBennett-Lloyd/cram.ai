import { describe, expect, it } from 'vitest';
import { Citation } from './citation';

describe('Citation', () => {
  it('parses a source id with a verbatim quote', () => {
    expect(Citation.safeParse({ sourceId: 'slide-1', quote: 'mitochondria' }).success).toBe(true);
  });

  it('refuses a whitespace-only quote, which every source would contain', () => {
    expect(Citation.safeParse({ sourceId: 'slide-1', quote: ' \n\t' }).success).toBe(false);
  });

  it('refuses an empty source id', () => {
    expect(Citation.safeParse({ sourceId: '', quote: 'mitochondria' }).success).toBe(false);
  });
});
