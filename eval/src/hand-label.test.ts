import { describe, expect, it } from 'vitest';
import { HandLabel } from './hand-label';

describe('HandLabel', () => {
  it('refuses a label with no quotes, which resolution would have withheld', () => {
    expect(HandLabel.safeParse({ text: 't', quotes: [], verdict: 'supported' }).success).toBe(
      false,
    );
  });

  it('refuses a field beyond text, quotes and verdict', () => {
    const line = { text: 't', quotes: ['q'], verdict: 'supported', sourceId: 's' };
    expect(HandLabel.safeParse(line).success).toBe(false);
  });

  it('refuses a verdict outside the closed set', () => {
    expect(HandLabel.safeParse({ text: 't', quotes: ['q'], verdict: 'true' }).success).toBe(false);
  });
});
