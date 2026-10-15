import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { Unit } from './unit';

type UnitInput = z.input<typeof Unit>;

const unit = (overrides: Partial<UnitInput> = {}): UnitInput => ({
  text: 'Slide 3 says the cell has a nucleus.',
  citations: [{ sourceId: 'slide-3', quote: 'the cell has a nucleus' }],
  kind: 'answer-sentence',
  ...overrides,
});

describe('Unit', () => {
  it('parses a unit with zero citations, leaving resolution to withhold it', () => {
    expect(Unit.safeParse(unit({ citations: [] })).success).toBe(true);
  });

  it('refuses blank text', () => {
    expect(Unit.safeParse(unit({ text: '   ' })).success).toBe(false);
  });

  it('refuses a kind outside the closed set', () => {
    expect(Unit.safeParse({ ...unit(), kind: 'caveat' }).success).toBe(false);
  });

  it('refuses a unit carrying a citation with a blank quote', () => {
    const citations = [{ sourceId: 'slide-3', quote: '' }];
    expect(Unit.safeParse(unit({ citations })).success).toBe(false);
  });
});
