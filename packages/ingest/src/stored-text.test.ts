import { normalizeUnicode } from 'unpdf/pdfjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { storedPage, storedText } from './stored-text';

const EVERY_CHARACTER = Array.from({ length: 0x110000 }, (_, codePoint) => codePoint)
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint));

const pdfjsFolds = (character: string): boolean =>
  z.string().parse(normalizeUnicode(character)) !== character;

/** The blocks math alphanumerics live in: Mathematical Alphanumeric Symbols, and the Letterlike Symbols filling its holes. */
const MATH_BLOCKS = /^[\u{1D400}-\u{1D7FF}\u2100-\u214F]$/u;

describe('storedText', () => {
  it("reads PowerPoint's styled characters in their NFKC form (#159)", () => {
    expect(storedText('𝐸=𝑚𝑐^2')).toBe('E=mc^2');
    const styled = ['ℎ𝐸𝑧', '𝐀𝐁𝐚𝐛', '𝒗𝒘', 'ℝℤ', 'ℒℋ', '𝔤ℜ', '𝘹𝘺', '𝚙𝚚', '𝛤𝜔𝜕𝛻𝜙𝜃', '𝛂', '𝟕', '𝟙𝟚'];
    expect(styled.map(storedText)).toEqual([
      'hEz',
      'ABab',
      'vw',
      'RZ',
      'LH',
      'gR',
      'xy',
      'pq',
      'Γω∂∇φθ',
      'α',
      '7',
      '12',
    ]);
  });

  it("reads the block's last character, and every Letterlike Symbol filling one of its holes", () => {
    expect(storedText('𝟿')).toBe('9');
    expect(storedText('ℂℊℋℌℍℎℐℑℒℕℙℚℛℜℝℤℨℬℭℯℰℱℳℴ')).toBe('CgHHHhIILNPQRRRZZBCeEFMo');
  });

  it("reads every character pdf.js's normalizeUnicode folds in its NFKC form, ﬅ as st (#256)", () => {
    expect(
      storedText('5 \u00B5m, \uFB01ne \uFB02ow, \uFB05 \uFB06, 10 k\u2126,\u00A0a\u2009b'),
    ).toBe('5 \u03BCm, fine flow, st st, 10 k\u03A9, a b');
    const unfolded = EVERY_CHARACTER.filter(pdfjsFolds).filter(
      (character) => storedText(character) !== character.normalize('NFKC'),
    );
    expect(unfolded).toEqual([]);
  });

  it('leaves every other compatibility character as written', () => {
    expect(storedText('ℓⅆ…²′∬')).toBe('ℓⅆ…²′∬');
    const folded = EVERY_CHARACTER.filter(
      (character) => storedText(character) !== character.normalize('NFC'),
    );
    expect(
      folded.filter((character) => !pdfjsFolds(character) && !MATH_BLOCKS.test(character)),
    ).toEqual([]);
  });

  it('composes an accent with its base, a folded one included, where Unicode has the composite', () => {
    expect(storedText('cafe\u0301')).toBe('caf\u00E9');
    expect(storedText('𝑎\u0302')).toBe('\u00E2');
    expect(storedText('𝑥\u0305')).toBe('x\u0305');
  });
});

describe('storedPage', () => {
  it('stores every text a page carries, and keeps its sizes', () => {
    expect(
      storedPage({
        markedTitle: 'Cafe\u0301 𝑥',
        lines: [{ text: '𝐸=𝑚𝑐^2', size: 24 }],
        notes: '𝑎\u0302',
      }),
    ).toEqual({
      markedTitle: 'Caf\u00E9 x',
      lines: [{ text: 'E=mc^2', size: 24 }],
      notes: '\u00E2',
    });
  });

  it('leaves a page with no marked title without one', () => {
    expect(storedPage({ lines: [], notes: '' })).toStrictEqual({ lines: [], notes: '' });
  });
});
