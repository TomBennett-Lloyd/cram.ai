import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { linearOmml } from './omml';
import { NS } from './ooxml';

const linear = (omml: string): string => {
  const doc = new DOMParser().parseFromString(
    `<a14:m xmlns:a14="${NS.a14}" xmlns:m="${NS.m}" xmlns:a="${NS.a}">${omml}</a14:m>`,
    'text/xml',
  );
  if (doc.documentElement === null) throw new Error('fixture did not parse');
  return linearOmml(doc.documentElement);
};

/** A run as PowerPoint writes it, its DrawingML properties beside the math text. */
const r = (text: string): string => `<m:r><a:rPr sz="2400" i="1"/><m:t>${text}</m:t></m:r>`;
const arg = (name: string, ...content: readonly string[]): string =>
  `<m:${name}>${content.join('')}</m:${name}>`;
const e = (...content: readonly string[]): string => arg('e', ...content);
/** A construct with its `m:<name>Pr` properties, each `[property, val]`. */
const construct = (
  name: string,
  properties: readonly (readonly [string, string])[],
  ...args: readonly string[]
): string =>
  `<m:${name}><m:${name}Pr>${properties.map(([property, val]) => `<m:${property} m:val="${val}"/>`).join('')}<m:ctrlPr><a:rPr/></m:ctrlPr></m:${name}Pr>${args.join('')}</m:${name}>`;
const oMath = (...content: readonly string[]): string => arg('oMath', ...content);
const sup = (base: string, exponent: string): string =>
  construct('sSup', [], e(base), arg('sup', exponent));
const parens = (...content: readonly string[]): string => construct('d', [], e(...content));

describe('linearOmml', () => {
  it("joins runs' text and reads a superscript after its base", () => {
    expect(linear(oMath(r('E=m'), sup(r('c'), r('2'))))).toBe('E=mc^2');
  });

  it('reads a fraction as numerator/denominator and a no-bar fraction with ¦', () => {
    expect(linear(oMath(construct('f', [], arg('num', r('a+b')), arg('den', r('c')))))).toBe(
      '(a+b)/c',
    );
    expect(
      linear(oMath(construct('f', [['type', 'lin']], arg('num', r('n')), arg('den', r('k'))))),
    ).toBe('n/k');
    expect(
      linear(oMath(construct('f', [['type', 'noBar']], arg('num', r('n')), arg('den', r('k'))))),
    ).toBe('n¦k');
  });

  describe('operand brackets', () => {
    it('leaves a run of letters and digits, and a single character, unbracketed', () => {
      expect(linear(oMath(sup(r('x'), r('2n'))))).toBe('x^2n');
      expect(linear(oMath(construct('sSub', [], e(r('x')), arg('sub', r('ij')))))).toBe('x_ij');
      expect(linear(oMath(sup(r('10'), r('23'))))).toBe('10^23');
      expect(linear(oMath(sup(r('x'), r('∞'))))).toBe('x^∞');
    });

    it('brackets an operand of more than one token', () => {
      expect(linear(oMath(sup(r('x'), r('n+1'))))).toBe('x^(n+1)');
      expect(linear(oMath(sup(r('x'), r('-n'))))).toBe('x^(-n)');
      expect(linear(oMath(sup(r('x'), r('n-'))))).toBe('x^(n-)');
      expect(linear(oMath(sup(r('e'), sup(r('x'), r('2')))))).toBe('e^(x^2)');
    });

    it('brackets an empty base, so the script keeps a base to attach to', () => {
      expect(linear(oMath(sup('', r('2'))))).toBe('()^2');
    });

    it('brackets a compound base, denominator or accented operand', () => {
      const xy = r('x+y');
      expect(linear(oMath(construct('f', [], arg('num', r('a')), arg('den', xy))))).toBe('a/(x+y)');
      expect(linear(oMath(sup(xy, r('2'))))).toBe('(x+y)^2');
      expect(linear(oMath(construct('sSub', [], e(xy), arg('sub', r('i')))))).toBe('(x+y)_i');
      expect(
        linear(oMath(construct('sSubSup', [], e(xy), arg('sub', r('i')), arg('sup', r('2'))))),
      ).toBe('(x+y)_i^2');
      expect(
        linear(oMath(construct('sPre', [], arg('sub', r('1')), arg('sup', r('2')), e(xy)))),
      ).toBe('_1^2 (x+y)');
      expect(linear(oMath(construct('limLow', [], e(xy), arg('lim', r('n')))))).toBe('(x+y)_n');
      expect(linear(oMath(construct('limUpp', [], e(xy), arg('lim', r('n')))))).toBe('(x+y)^n');
      expect(linear(oMath(construct('acc', [], e(xy))))).toBe('(x+y)\u0302');
    });

    it('does not bracket a delimiter group again, beside properties that show nothing', () => {
      expect(linear(oMath(sup(parens(r('a+b')) + '<m:ctrlPr><a:rPr/></m:ctrlPr>', r('2'))))).toBe(
        '(a+b)^2',
      );
    });

    it('brackets a delimiter group that has a neighbour', () => {
      expect(linear(oMath(sup(parens(r('a')) + r('b'), r('2'))))).toBe('((a)b)^2');
    });
  });

  it('reads subscripts, sub-superscripts and prescripts', () => {
    expect(
      linear(oMath(construct('sSubSup', [], e(r('x')), arg('sub', r('i')), arg('sup', r('2'))))),
    ).toBe('x_i^2');
    expect(
      linear(oMath(construct('sPre', [], arg('sub', r('6')), arg('sup', r('14')), e(r('C'))))),
    ).toBe('_6^14 C');
  });

  it('omits an empty script with its operator', () => {
    expect(linear(oMath(sup(r('x'), '')))).toBe('x');
    expect(linear(oMath(construct('sSub', [], e(r('x')), arg('sub'))))).toBe('x');
  });

  it('reads a square root, and a root with a degree as √(degree&radicand)', () => {
    expect(linear(oMath(construct('rad', [], arg('deg'), e(r('x')))))).toBe('√x');
    expect(linear(oMath(construct('rad', [], arg('deg'), e(r('b'), r('-4ac')))))).toBe('√(b-4ac)');
    expect(linear(oMath(construct('rad', [], arg('deg', r('3')), e(r('x+1')))))).toBe('√(3&x+1)');
  });

  it('reads an n-ary operator, an integral by default, with its limits and then its argument', () => {
    expect(
      linear(
        oMath(
          construct(
            'nary',
            [['chr', '∑']],
            arg('sub', r('i=1')),
            arg('sup', r('n')),
            e(construct('sSub', [], e(r('x')), arg('sub', r('i')))),
          ),
        ),
      ),
    ).toBe('∑_(i=1)^n x_i');
    expect(
      linear(oMath(construct('nary', [], arg('sub', r('0')), arg('sup', r('1')), e(r('f'))))),
    ).toBe('∫_0^1 f');
  });

  it("reads a delimiter group's characters, defaulting to ( | ), with an empty value as none", () => {
    expect(linear(oMath(construct('d', [], e(r('a')), e(r('b')))))).toBe('(a|b)');
    expect(
      linear(
        oMath(
          construct(
            'd',
            [
              ['begChr', '['],
              ['sepChr', ','],
              ['endChr', ']'],
            ],
            e(r('a')),
            e(r('b')),
          ),
        ),
      ),
    ).toBe('[a,b]');
    expect(linear(oMath(construct('d', [['endChr', '']], e(r('x')))))).toBe('(x');
  });

  it('reads a function as its name, a space and its argument, and a limit under its base', () => {
    expect(linear(oMath(construct('func', [], arg('fName', r('sin')), e(r('θ')))))).toBe('sin θ');
    const limit = construct('limLow', [], e(r('lim')), arg('lim', r('n→∞')));
    expect(
      linear(
        oMath(
          construct(
            'func',
            [],
            arg('fName', limit),
            e(construct('sSub', [], e(r('a')), arg('sub', r('n')))),
          ),
        ),
      ),
    ).toBe('lim_(n→∞) a_n');
    expect(linear(oMath(construct('limUpp', [], e(r('A')), arg('lim', r('∗')))))).toBe('A^∗');
  });

  it('reads an accent, a circumflex by default, after its base', () => {
    expect(linear(oMath(construct('acc', [], e(r('x')))))).toBe('x\u0302');
    expect(linear(oMath(construct('acc', [['chr', '\u20D7']], e(r('v')))))).toBe('v\u20D7');
  });

  it('reads a bar, below by default, as a combining line after its base', () => {
    expect(linear(oMath(construct('bar', [], e(r('x')))))).toBe('x\u0332');
    expect(linear(oMath(construct('bar', [['pos', 'top']], e(r('x+y')))))).toBe('(x+y)\u0305');
  });

  it('reads a grouping character, a bottom brace by default, before its base', () => {
    expect(linear(oMath(construct('groupChr', [], e(r('a+b')))))).toBe('\u23DF(a+b)');
    expect(linear(oMath(construct('groupChr', [['chr', '⏞']], e(r('a')))))).toBe('⏞a');
  });

  it('reads a matrix row by row and an equation array line by line', () => {
    const row = (...cells: readonly string[]): string =>
      arg('mr', ...cells.map((cell) => e(r(cell))));
    expect(linear(oMath(parens(construct('m', [], row('a', 'b'), row('c', 'd')))))).toBe(
      '(a, b; c, d)',
    );
    expect(linear(oMath(construct('eqArr', [], e(r('x=1')), e(r('y=2')))))).toBe('x=1; y=2');
  });

  it('reads the wrappers and any element outside the construct table as their contents', () => {
    expect(
      linear(oMath(construct('box', [], e(r('x'))), construct('borderBox', [], e(r('y'))))),
    ).toBe('xy');
    expect(linear(oMath(arg('unlisted', r('a'), sup(r('b'), r('2')))))).toBe('ab^2');
  });

  it('reads a phantom as its contents unless it is shown off', () => {
    expect(linear(oMath(construct('phant', [], e(r('z')))))).toBe('z');
    expect(linear(oMath(construct('phant', [['show', 'on']], e(r('z')))))).toBe('z');
    for (const off of ['off', 'false', '0'])
      expect(linear(oMath(r('a'), construct('phant', [['show', off]], e(r('z'))), r('b')))).toBe(
        'ab',
      );
  });

  describe('math alphanumerics (#159)', () => {
    it("reads each of PowerPoint's styled letters and digits as its plain one", () => {
      expect(linear(oMath(r('𝐸'), r('='), r('𝑚'), sup(r('𝑐'), r('2'))))).toBe('E=mc^2');
      const styled = ['ℎ𝐸𝑧', '𝐀𝐁𝐚𝐛', '𝒗𝒘', 'ℝℤ', 'ℒℋ', '𝔤ℜ', '𝘹𝘺', '𝚙𝚚', '𝛤𝜔𝜕𝛻𝜙𝜃', '𝛂', '𝟕', '𝟙𝟚'];
      expect(styled.map((text) => linear(oMath(r(text))))).toEqual([
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
      expect(linear(oMath(r('𝟿')))).toBe('9');
      expect(linear(oMath(r('ℂℊℋℌℍℎℐℑℒℕℙℚℛℜℝℤℨℬℭℯℰℱℳℴ')))).toBe('CgHHHhIILNPQRRRZZBCeEFMo');
    });

    it('leaves every other compatibility character as written', () => {
      expect(linear(oMath(r('ℓⅆ…²′∬ﬁµ')))).toBe('ℓⅆ…²′∬ﬁµ');
    });

    it('composes an accent with its plain base where Unicode has the composite', () => {
      expect(linear(oMath(construct('acc', [], e(r('𝑎')))))).toBe('\u00E2');
      expect(linear(oMath(construct('bar', [['pos', 'top']], e(r('𝑥')))))).toBe('x\u0305');
    });
  });

  it('reads each equation of a display paragraph, spaced', () => {
    expect(linear(arg('oMathPara', '<m:oMathParaPr/>', oMath(r('a=b')), oMath(r('c=d'))))).toBe(
      'a=b c=d',
    );
  });

  it('reads each element once, so a deep nesting is read in milliseconds', () => {
    // Read without the cache, depth 20 takes seconds: each level reads its operand twice.
    const depth = 20;
    let nested = r('x');
    for (let level = 0; level < depth; level++) nested = sup(nested, r('2'));
    const started = performance.now();
    expect(linear(oMath(nested))).toBe(`${'('.repeat(depth - 1)}x${'^2)'.repeat(depth - 1)}^2`);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
