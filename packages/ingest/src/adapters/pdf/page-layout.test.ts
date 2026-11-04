import { getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildDeck, CALL_OUT_SLIDE } from './deck-fixture';
import {
  COLUMN_GAP_EMS,
  FOOTER_BAND,
  layOutPages,
  linesOf,
  pageTextOf,
  type PdfPageText,
  type PdfTextItem,
} from './page-layout';

const HEIGHT = 540;

interface Drawn {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  readonly width?: number;
  readonly hasEOL?: true;
}

/** pdf.js's shape for an unrotated item; the width defaults to a nominal half-em per character. */
const item = ({ str, x, y, size = 18, width, hasEOL }: Drawn): PdfTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: width ?? (str.length * size) / 2,
  hasEOL: hasEOL ?? false,
});

const page = (drawn: readonly Drawn[], bottom = 0): PdfPageText => ({
  items: drawn.map(item),
  bottom,
  height: HEIGHT,
});

const textsOf = (drawn: readonly Drawn[], pageNo = 1, bottom = 0): string[] =>
  linesOf(page(drawn, bottom), pageNo)
    .map((line) => line.text.trim())
    .filter((text) => text !== '');

describe('linesOf', () => {
  it("ends a line at pdf.js's hasEOL", () => {
    expect(
      textsOf([
        { str: 'One', x: 40, y: 300, hasEOL: true },
        { str: 'Two', x: 70, y: 300 },
      ]),
    ).toEqual(['One', 'Two']);
  });

  it('starts each line fresh after hasEOL, so a far item opens no empty line', () => {
    const lines = linesOf(
      page([
        { str: 'One', x: 40, y: 300, width: 30, hasEOL: true },
        { str: 'Two', x: 40, y: 100, width: 30 },
      ]),
      1,
    );
    expect(lines.map((line) => line.text)).toEqual(['One', 'Two']);
  });

  it('ends a line where the baseline moves by more than the smaller glyph, up or down (#356)', () => {
    const under = (dy: number): Drawn[] => [
      { str: 'A large title', x: 40, y: 400, size: 40, width: 100 },
      { str: 'small body', x: 140, y: 400 + dy, size: 11, width: 50 },
    ];
    expect(textsOf(under(-11))).toEqual(['A large titlesmall body']);
    expect(textsOf(under(-11.01))).toEqual(['A large title', 'small body']);
    expect(textsOf(under(-15))).toEqual(['A large title', 'small body']);
    expect(textsOf(under(11.01))).toEqual(['A large title', 'small body']);
  });

  it('keeps a superscript on its line', () => {
    expect(
      textsOf([
        { str: 'E = mc', x: 40, y: 300, size: 18, width: 60 },
        { str: '2', x: 100, y: 305.4, size: 12, width: 6 },
      ]),
    ).toEqual(['E = mc2']);
  });

  it(`ends a line at a gap wider than ${String(COLUMN_GAP_EMS)} ems of the smaller glyph, either side, on a shared baseline`, () => {
    const gapped = (gap: number): Drawn[] => [
      { str: 'Lecture title', x: 40, y: 490, size: 28, width: 100 },
      { str: ' ', x: 140, y: 490, size: 28, width: gap },
      { str: 'call-out', x: 140 + gap, y: 490, size: 12, width: 50 },
    ];
    expect(textsOf(gapped(COLUMN_GAP_EMS * 12))).toEqual(['Lecture title call-out']);
    expect(textsOf(gapped(COLUMN_GAP_EMS * 12 + 0.01))).toEqual(['Lecture title', 'call-out']);
    const leftOf = (gap: number): Drawn[] => [
      { str: '7', x: 900, y: 300, size: 10, width: 6 },
      { str: '© Course', x: 900 - gap - 50, y: 300, size: 10, width: 50 },
    ];
    expect(textsOf(leftOf(COLUMN_GAP_EMS * 10))).toEqual(['7© Course']);
    expect(textsOf(leftOf(COLUMN_GAP_EMS * 10 + 0.01))).toEqual(['7', '© Course']);
  });

  it('places a blank item nowhere, so it neither breaks nor joins a line', () => {
    expect(
      textsOf([
        { str: 'Left', x: 40, y: 300, width: 40 },
        { str: ' ', x: 900, y: 20, width: 5 },
        { str: 'right', x: 85, y: 300, width: 40 },
      ]),
    ).toEqual(['Left right']);
  });

  it('drops a digits-only item equal to the page number in the footer band, even sharing a line, and keeps its hasEOL', () => {
    const footer = (str: string, y = 20, bottom = 0): string[] =>
      textsOf(
        [
          { str: '© Course, Year.', x: 300, y, size: 10, width: 100 },
          { str, x: 405, y, size: 10, width: 10, hasEOL: true },
          { str: 'Next', x: 420, y, size: 10, width: 20 },
        ],
        3,
        bottom,
      );
    expect(footer('3')).toEqual(['© Course, Year.', 'Next']);
    expect(footer(' 3 ')).toEqual(['© Course, Year.', 'Next']);
    expect(footer('4')).toEqual(['© Course, Year.4', 'Next']);
    expect(footer('+3')).toEqual(['© Course, Year.+3', 'Next']);
    expect(footer('3.')).toEqual(['© Course, Year.3.', 'Next']);
    const band = FOOTER_BAND * HEIGHT;
    expect(footer('3', band - 0.01)).toEqual(['© Course, Year.', 'Next']);
    expect(footer('3', band)).toEqual(['© Course, Year.3', 'Next']);
    expect(footer('3', 100 + band - 0.01, 100)).toEqual(['© Course, Year.', 'Next']);
    expect(footer('3', 100 + band, 100)).toEqual(['© Course, Year.3', 'Next']);
  });

  it('boxes a line from its leftmost to its rightmost glyph, on its first baseline, sized by its largest', () => {
    expect(
      linesOf(
        page([
          { str: 'E = mc', x: 60, y: 300, size: 18, width: 60 },
          { str: 'e', x: 50, y: 301, size: 18, width: 8 },
          { str: '2', x: 120, y: 305, size: 12, width: 6 },
        ]),
        1,
      ),
    ).toEqual([{ text: 'E = mce2', size: 18, box: { left: 50, right: 126, baseline: 300 } }]);
  });
});

const FOOTER: Drawn = { str: '© Example College', x: 300, y: 80, size: 10, width: 100 };

const deckOf = (pages: readonly (readonly Drawn[])[]): PdfPageText[] =>
  pages.map((drawn) => page(drawn));

const laidOut = (pages: readonly (readonly Drawn[])[]): { lines: string[]; footer: string[] }[] =>
  layOutPages(deckOf(pages)).map(({ lines, footer }) => ({
    lines: lines.map((line) => line.text),
    footer: footer.map((line) => line.text),
  }));

const body = (n: number): Drawn => ({ str: `Body of slide ${String(n)}`, x: 40, y: 400 });

describe('layOutPages', () => {
  it('partitions out a lower-half line that recurs at one position on more than half the pages', () => {
    expect(laidOut([[body(1), FOOTER], [body(2), FOOTER], [body(3)]])).toEqual([
      { lines: ['Body of slide 1'], footer: ['© Example College'] },
      { lines: ['Body of slide 2'], footer: ['© Example College'] },
      { lines: ['Body of slide 3'], footer: [] },
    ]);
    expect(laidOut([[body(1), FOOTER], [body(2), FOOTER], [body(3)], [body(4)]])).toEqual([
      { lines: ['Body of slide 1', '© Example College'], footer: [] },
      { lines: ['Body of slide 2', '© Example College'], footer: [] },
      { lines: ['Body of slide 3'], footer: [] },
      { lines: ['Body of slide 4'], footer: [] },
    ]);
  });

  it('counts a line once per page', () => {
    const twice: Drawn[] = [body(1), { ...FOOTER, hasEOL: true }, FOOTER];
    expect(laidOut([twice, [body(2)], [body(3)]]).map(({ footer }) => footer)).toEqual([
      [],
      [],
      [],
    ]);
  });

  it('never reads a line in the upper half as a footer, however often it recurs', () => {
    const at = (y: number): Drawn => ({ str: 'Worked example', x: 40, y, size: 28 });
    const footers = (y: number): string[][] =>
      laidOut([[at(y)], [at(y)], [at(y)]]).map(({ footer }) => footer);
    expect(footers(HEIGHT / 2 - 0.01)).toEqual([
      ['Worked example'],
      ['Worked example'],
      ['Worked example'],
    ]);
    expect(footers(HEIGHT / 2)).toEqual([[], [], []]);
  });

  it('keys a recurring line on its collapsed text, its rounded left edge and its rounded baseline', () => {
    const footers = (moved: Drawn): string[][] =>
      laidOut([[FOOTER], [FOOTER], [moved]]).map(({ footer }) => footer);
    expect(footers({ ...FOOTER, str: '© Example  College ', x: 300.4, y: 80.4 })).toEqual([
      ['© Example College'],
      ['© Example College'],
      ['© Example  College '],
    ]);
    expect(footers({ ...FOOTER, str: '© Example Colleges' })[2]).toEqual([]);
    expect(footers({ ...FOOTER, x: 301 })[2]).toEqual([]);
    expect(footers({ ...FOOTER, y: 81 })[2]).toEqual([]);
  });

  it("reads a one-page deck's bottom band as its footer, and only a one-page deck's", () => {
    const band = FOOTER_BAND * HEIGHT;
    const low = (y: number): Drawn => ({ ...FOOTER, y });
    expect(laidOut([[body(1), low(band - 0.01)]])).toEqual([
      { lines: ['Body of slide 1'], footer: ['© Example College'] },
    ]);
    expect(laidOut([[body(1), low(band)]])).toEqual([
      { lines: ['Body of slide 1', '© Example College'], footer: [] },
    ]);
    expect(laidOut([[body(1), low(band - 0.01)], [body(2)]])[0]).toEqual({
      lines: ['Body of slide 1', '© Example College'],
      footer: [],
    });
  });

  it('measures the bottom band and the lower half from the bottom of the view box', () => {
    const footers = (pages: readonly PdfPageText[]): string[][] =>
      layOutPages(pages).map(({ footer }) => footer.map((line) => line.text));
    const raised = (y: number): PdfPageText => page([{ ...FOOTER, y: 100 + y }], 100);
    expect(footers([raised(FOOTER_BAND * HEIGHT - 0.01)])).toEqual([['© Example College']]);
    expect(footers([raised(FOOTER_BAND * HEIGHT)])).toEqual([[]]);
    const half = raised(HEIGHT / 2 - 0.01);
    expect(footers([half, half])).toEqual([['© Example College'], ['© Example College']]);
  });
});

const pdfjsPages = async (bytes: Uint8Array): Promise<PdfPageText[]> => {
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    return await Promise.all(
      Array.from({ length: pdf.numPages }, (_, index) => pageTextOf(pdf, index + 1)),
    );
  } finally {
    await pdf.loadingTask.destroy();
  }
};

describe('layOutPages over what pdf.js reads', () => {
  it("partitions out the issue's footer, drops its page number and gives each call-out and label its own line (#567)", async () => {
    const [laid] = layOutPages(
      await pdfjsPages(await buildDeck({ pages: [{ lines: CALL_OUT_SLIDE }] })),
    );
    expect(laid?.footer.map((line) => line.text)).toEqual([
      '© Example College: Course, Year. AB / CD.',
    ]);
    expect(laid?.lines.map((line) => line.text.trim()).filter((text) => text !== '')).toEqual([
      'Lecture title',
      'term = short definition',
      'Heading:',
      '• First bullet.',
      '• Second bullet, wrapped',
      'onto a second line.',
      '• Example: a sentence the tutor should be able to quote.',
      'in a call-out box',
      'Key:',
      'label',
      "Pronounced 'x'",
    ]);
  });
});
