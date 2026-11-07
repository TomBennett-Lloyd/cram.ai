import { describe, expect, it } from 'vitest';
import { line, slide } from './fake-gateway-fixture';
import { resolveQuotes } from './resolve-quotes';

const hive = slide('l1/1', 'Worker bees are male.\nThe queen is the colony’s only female.');
const comb = slide('l1/2', 'Bees build comb from square cells.');
const repeated = slide('l1/3', 'Drones\nDrones never forage.', { title: 'Drones' });
const retrieved = [hive, comb, repeated];

describe('resolveQuotes', () => {
  it('keeps a pointer whose line the text repeats, as the looked-up line', () => {
    const text = 'The slides put it plainly: "Worker bees are male." That surprises people.';
    expect(resolveQuotes(text, [line('l1/1', 'Worker bees are male.')], retrieved)).toEqual({
      quotes: [{ sourceId: 'l1/1', quote: 'Worker bees are male.' }],
      withheld: [],
    });
  });

  it('reads whitespace runs in the text as one space, and nothing else', () => {
    const spaced = 'Worker   bees\nare male.';
    expect(
      resolveQuotes(spaced, [line('l1/1', 'Worker bees are male.')], retrieved).quotes,
    ).toHaveLength(1);
    const cased = 'worker bees are male.';
    expect(resolveQuotes(cased, [line('l1/1', 'Worker bees are male.')], retrieved).quotes).toEqual(
      [],
    );
  });

  it('withholds a pointer to a line the text does not repeat, with that line as its text', () => {
    const text = 'Workers are male.';
    expect(
      resolveQuotes(text, [line('l1/1', 'The queen is the colony’s only female.')], retrieved),
    ).toEqual({
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
    ['altered by one character', line('l1/2', 'Bees build comb from square cells')],
    ['equal to two lines of its slide', line('l1/3', 'Drones')],
    ['on a slide not retrieved', line('l9/9', 'Worker bees are male.')],
  ])('withholds a pointer %s, with the copy as its text', (_, pointer) => {
    const text = 'Drones. Bees build comb from square cells. Worker bees are male.';
    expect(resolveQuotes(text, [pointer], retrieved)).toEqual({
      quotes: [],
      withheld: [{ reason: 'dangling-citation', text: pointer.line, sourceId: pointer.sourceId }],
    });
  });

  it('settles each pointer on its own, in the order given', () => {
    const text = 'Worker bees are male. Bees build comb from square cells.';
    const resolved = resolveQuotes(
      text,
      [
        line('l1/2', 'Bees build comb from square cells.'),
        line('l1/1', 'The queen is the colony’s only female.'),
        line('l1/1', 'Worker bees are male.'),
      ],
      retrieved,
    );
    expect(resolved.quotes.map(({ sourceId }) => sourceId)).toEqual(['l1/2', 'l1/1']);
    expect(resolved.withheld).toHaveLength(1);
  });
});
