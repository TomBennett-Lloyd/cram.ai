import { describe, expect, it } from 'vitest';
import { storedPage, storedText } from './stored-text';

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

  it('leaves every other compatibility character as written', () => {
    expect(storedText('ℓⅆ…²′∬ﬁµ')).toBe('ℓⅆ…²′∬ﬁµ');
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
