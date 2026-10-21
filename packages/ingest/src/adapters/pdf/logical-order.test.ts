import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildDeck } from './deck-fixture';
import { logicalOrder } from './logical-order';

/** Hebrew and Arabic letters at the ends of `bidi`'s R and AL ranges, Latin-1 letters and neutrals, no digit. */
const PLAIN = [
  ...['\u05d0', '\u05d1', '\u05e7', '\u05e8', '\u05e9', '\u0591', '\u05f4'],
  ...['\u0710', '\u08ac', '\ufb50', '\ufdfd', '\ufe70', '\ufefc'],
  ...['a', 'b', 'x', '\u00e9', '\u00aa', '.', ',', '(', '!', '-', '\u00d7', '\u00f7'],
];

/** Each Hebrew presentation form drawn, with a plain Hebrew letter `PLAIN` lacks, which `bidi` already types R. */
const STAND_IN = new Map([
  ['\ufb1d', '\u05ea'],
  ['\ufb2a', '\u05e1'],
  ['\ufb31', '\u05e6'],
  ['\ufb4b', '\u05e4'],
  ['\ufb4f', '\u05d8'],
]);

/** Seeded, so a failing line reproduces: words of up to four units, single spaces between. */
const linesOf = (alphabet: readonly string[], count: number, seed: number): string[] => {
  let state = seed;
  const next = (bound: number): number => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state % bound;
  };
  const word = (): string =>
    Array.from({ length: 1 + next(4) }, () => alphabet[next(alphabet.length)] ?? '').join('');
  return Array.from({ length: count }, () => Array.from({ length: 1 + next(3) }, word).join(' '));
};

/** Each line drawn left to right on its own page, read back as pdf.js's text items. */
const pdfjsItems = async (lines: readonly string[]): Promise<string[][]> => {
  const pages = lines.map((text) => ({ lines: [{ text, size: 28, toUnicode: true as const }] }));
  const pdf = await getDocumentProxy((await buildDeck({ pages })).slice(), { verbosity: 0 });
  try {
    const read: string[][] = [];
    for (let pageNo = 1; pageNo <= lines.length; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const { items } = await page.getTextContent({ disableNormalization: true });
      read.push(items.map((item) => ('str' in item ? item.str : '')));
    }
    return read;
  } finally {
    await pdf.loadingTask.destroy();
  }
};

const ordered = (items: readonly string[]): string => items.map(logicalOrder).join('');

const swapped = (text: string, pairs: ReadonlyMap<string, string>): string =>
  Array.from(text, (unit) => pairs.get(unit) ?? unit).join('');

describe('logicalOrder', () => {
  it("keeps pdf.js's order for a line holding no Hebrew presentation form", async () => {
    const read = await pdfjsItems(linesOf(PLAIN, 120, 283));
    expect(read.map(ordered)).toEqual(read.map((items) => items.join('')));
  });

  it('orders Hebrew presentation forms as pdf.js orders a plain Hebrew letter drawn in their place', async () => {
    const lines = linesOf([...PLAIN, ...STAND_IN.keys(), ...STAND_IN.keys()], 120, 256);
    const read = await pdfjsItems(lines);
    const standIns = await pdfjsItems(lines.map((text) => swapped(text, STAND_IN)));
    const back = new Map([...STAND_IN].map(([form, letter]) => [letter, form]));
    expect(read.map(ordered)).toEqual(standIns.map((items) => swapped(items.join(''), back)));
  });

  it("keeps pdf.js's order once a digit takes part, since two drawn lines then share one", async () => {
    const [first, second] = await pdfjsItems(['\ufb31 1\u05e8', '1 \ufb31\u05e8']);
    expect(first).toEqual(second);
    expect(ordered(first ?? [])).toBe(first?.join(''));
  });

  it.each([
    '0',
    '9',
    '\u00b2',
    '\u00b3',
    '\u00b9',
    '\u0600',
    '\u06ff',
    '\u0001',
    '\u009f',
    '\u00ad',
  ])(
    "keeps pdf.js's order for an item holding %j, whose bidi class logicalOrder does not model",
    (unit) => {
      const text = `\ufb31\ufb4b ${unit}`;
      expect(logicalOrder(text)).toBe(text);
    },
  );
});
