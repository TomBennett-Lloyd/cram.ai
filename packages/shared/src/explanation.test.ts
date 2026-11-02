import { describe, expect, it } from 'vitest';
import { Explanation } from './explanation';

const sentence = { text: 'Worker bees are male.', slides: ['l1/3'], contradicts: [] };
const explanation = {
  text: 'Worker bees are male.',
  quotes: [{ sourceId: 'l1/3', quote: 'Worker bees are male.' }],
  sentences: [sentence],
  sources: ['l1/3'],
};

describe('Explanation', () => {
  it('parses an explanation with one sentence and one source', () => {
    expect(Explanation.safeParse(explanation).success).toBe(true);
  });

  it('refuses one with no sentence or no source', () => {
    expect(Explanation.safeParse({ ...explanation, sentences: [] }).success).toBe(false);
    expect(Explanation.safeParse({ ...explanation, sources: [] }).success).toBe(false);
  });

  it('refuses blank text and a sentence without its contradiction list', () => {
    expect(Explanation.safeParse({ ...explanation, text: ' ' }).success).toBe(false);
    const unmarked = { text: sentence.text, slides: sentence.slides };
    expect(Explanation.safeParse({ ...explanation, sentences: [unmarked] }).success).toBe(false);
  });
});
