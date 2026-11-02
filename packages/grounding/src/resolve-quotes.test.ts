import { describe, expect, it } from 'vitest';
import { line, slide } from './fake-gateway-fixture';
import { resolveQuotes } from './resolve-quotes';

const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const retrieved = [hive, comb];

describe('resolveQuotes', () => {
  it('keeps a pointer whose line the text repeats, as the looked-up line', () => {
    const text = 'The slides put it plainly: "Worker bees are male." That surprises people.';
    expect(resolveQuotes(text, [line('l1/1', 1)], retrieved)).toEqual({
      quotes: [{ sourceId: 'l1/1', quote: 'Worker bees are male.' }],
      withheld: [],
    });
  });

  it('reads whitespace runs in the text as one space, and nothing else', () => {
    const spaced = 'Worker   bees\nare male.';
    expect(resolveQuotes(spaced, [line('l1/1', 1)], retrieved).quotes).toHaveLength(1);
    const cased = 'worker bees are male.';
    expect(resolveQuotes(cased, [line('l1/1', 1)], retrieved).quotes).toEqual([]);
  });

  it('withholds a pointer to a line the text does not repeat, with that line as its text', () => {
    const text = 'Workers are male.';
    expect(resolveQuotes(text, [line('l1/1', 2)], retrieved)).toEqual({
      quotes: [],
      withheld: [
        {
          reason: 'dangling-citation',
          text: 'The queen is the colony’s only female.',
          sourceId: 'l1/1',
        },
      ],
    });
  });

  it.each([
    ['past the slide’s last line', line('l1/2', 2), '[2]'],
    ['numbered zero', line('l1/2', 0), '[0]'],
    ['on a slide not retrieved', line('l9/9', 1), '[1]'],
  ])('withholds a pointer %s, shown as the prompt numbers it', (_, pointer, text) => {
    expect(resolveQuotes('Bees build comb from square cells.', [pointer], retrieved)).toEqual({
      quotes: [],
      withheld: [{ reason: 'dangling-citation', text, sourceId: pointer.sourceId }],
    });
  });

  it('settles each pointer on its own, in the order given', () => {
    const text = 'Worker bees are male. Bees build comb from square cells.';
    const resolved = resolveQuotes(
      text,
      [line('l1/2', 1), line('l1/1', 2), line('l1/1', 1)],
      retrieved,
    );
    expect(resolved.quotes.map(({ sourceId }) => sourceId)).toEqual(['l1/2', 'l1/1']);
    expect(resolved.withheld).toHaveLength(1);
  });
});
