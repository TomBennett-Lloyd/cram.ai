import { describe, expect, it } from 'vitest';
import { line, slide } from './fake-gateway-fixture';
import { FOUND_QUOTE_MIN_WORDS, resolveQuotes } from './resolve-quotes';

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
    expect(resolveQuotes('Bees build comb.', [pointer], retrieved)).toEqual({
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

  it('marks a whole slide line the text repeats and the model did not list', () => {
    const text = 'Comb is how they store food. Bees build comb from square cells.';
    expect(resolveQuotes(text, [], retrieved)).toEqual({
      quotes: [{ sourceId: 'l1/2', quote: 'Bees build comb from square cells.' }],
      withheld: [],
    });
  });

  it('lists a found line once when a pointer already names it', () => {
    const text = 'Bees build comb from square cells.';
    expect(resolveQuotes(text, [line('l1/2', 1)], retrieved).quotes).toEqual([
      { sourceId: 'l1/2', quote: 'Bees build comb from square cells.' },
    ]);
  });

  it(`leaves a line under ${String(FOUND_QUOTE_MIN_WORDS)} words unmarked`, () => {
    const labelled = slide('l1/3', 'The bloom count\nDrones never forage at night.');
    expect(resolveQuotes('The bloom count rises.', [], [labelled]).quotes).toEqual([]);
  });

  it('leaves unmarked a line the text holds only inside a longer word, at either end', () => {
    const health = slide('l1/3', 'Hive health and inspection');
    expect(resolveQuotes('Hive health and inspections matter.', [], [health]).quotes).toEqual([]);
    const combs = slide('l1/4', 'combs hold honey and pollen');
    expect(resolveQuotes('Honeycombs hold honey and pollen.', [], [combs]).quotes).toEqual([]);
    expect(resolveQuotes('Hive health and inspection, weekly.', [], [health]).quotes).toEqual([
      { sourceId: 'l1/3', quote: 'Hive health and inspection' },
    ]);
  });

  it('counts a whitespace run inside a slide line as one gap between words', () => {
    const spaced = slide('l1/3', 'The  bloom count');
    expect(resolveQuotes('The bloom count rises.', [], [spaced]).quotes).toEqual([]);
  });

  it('puts found lines after the listed ones, each once, from every field of every slide', () => {
    const twice = slide(
      'l1/3',
      'Bees build comb from square cells.\nBees build comb from square cells.',
      {
        speakerNotes: 'Drones never forage at night.',
      },
    );
    const text =
      'Worker bees are male. Bees build comb from square cells. Drones never forage at night.';
    expect(resolveQuotes(text, [line('l1/1', 1)], [comb, twice, hive]).quotes).toEqual([
      { sourceId: 'l1/1', quote: 'Worker bees are male.' },
      { sourceId: 'l1/2', quote: 'Bees build comb from square cells.' },
      { sourceId: 'l1/3', quote: 'Bees build comb from square cells.' },
      { sourceId: 'l1/3', quote: 'Drones never forage at night.' },
    ]);
  });

  it('finds a line with the text’s whitespace collapsed and not with its case changed', () => {
    expect(
      resolveQuotes('Bees build\n comb from square cells.', [], retrieved).quotes,
    ).toHaveLength(1);
    expect(resolveQuotes('bees build comb from square cells.', [], retrieved).quotes).toEqual([]);
  });

  it('keeps a dangling pointer withheld beside a found line', () => {
    const resolved = resolveQuotes('Worker bees are male.', [line('l1/1', 2)], retrieved);
    expect(resolved.quotes).toEqual([{ sourceId: 'l1/1', quote: 'Worker bees are male.' }]);
    expect(resolved.withheld).toEqual([
      {
        reason: 'dangling-citation',
        text: 'The queen is the colony’s only female.',
        sourceId: 'l1/1',
      },
    ]);
  });
});
