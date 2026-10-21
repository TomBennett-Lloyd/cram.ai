import { equation } from './adapters/pptx/deck-fixture';

const r = (text: string): string => `<m:r><m:t>${text}</m:t></m:r>`;
const m = (name: string, ...content: readonly string[]): string =>
  `<m:${name}>${content.join('')}</m:${name}>`;
const e = (...content: readonly string[]): string => m('e', ...content);
/** A construct with its `m:<name>Pr` properties, each `[property, val]`. */
const construct = (
  name: string,
  properties: readonly (readonly [string, string])[],
  ...args: readonly string[]
): string =>
  `<m:${name}><m:${name}Pr>${properties.map(([property, val]) => `<m:${property} m:val="${val}"/>`).join('')}</m:${name}Pr>${args.join('')}</m:${name}>`;

/** `E=mc^2+â` as PowerPoint writes it: math italic letters, and the accent as a combining character. */
export const MASS_ENERGY = equation(
  m(
    'oMath',
    ...['𝐸', '=', '𝑚'].map(r),
    construct('sSup', [], e(r('𝑐')), m('sup', r('2'))),
    r('+'),
    construct('acc', [['chr', '̂']], e(r('𝑎'))),
  ),
);

/** Every construct `linearOmml` reads, each with its default properties and, where it has one, another. */
export const EVERY_CONSTRUCT = equation(
  m(
    'oMathPara',
    m(
      'oMath',
      construct('f', [], m('num', r('a')), m('den', r('b+c'))),
      construct('f', [['type', 'noBar']], m('num', r('n')), m('den', r('k'))),
      construct('f', [['type', 'skw']], m('num', r('p')), m('den', r('q'))),
      construct('f', [['type', 'lin']], m('num', r('s')), m('den', r('t'))),
      construct('sSub', [], e(r('x')), m('sub', r('i'))),
      construct('sSubSup', [], e(r('x')), m('sub', r('i')), m('sup', r('2'))),
      construct('sPre', [], m('sub', r('a')), m('sup', r('b')), e(r('C'))),
      construct('sSup', [], e(r('y')), m('sup')),
      construct('sSup', [], e(r('x')), m('sup', r('*'))),
    ),
    m(
      'oMath',
      construct('rad', [], m('deg'), e(r('x'))),
      construct('rad', [], m('deg', r('3')), e(r('x'))),
      construct('nary', [], m('sub', r('0')), m('sup', r('1')), e(r('f'))),
      construct('nary', [['chr', '∑']], m('sub', r('k')), m('sup'), e(r('k'))),
      construct('d', [], e(r('a')), e(r('b'))),
      construct(
        'd',
        [
          ['begChr', '{'],
          ['endChr', ''],
        ],
        e(r('one-sided')),
      ),
      construct(
        'd',
        [
          ['begChr', '['],
          ['sepChr', ','],
          ['endChr', ']'],
        ],
        e(r('p')),
        e(r('q')),
      ),
      construct('sSup', [], e(construct('d', [], e(r('u+v')))), m('sup', r('2'))),
      construct('sSup', [], e(r('u+v')), m('sup', r('ab'))),
    ),
    m(
      'oMath',
      construct('func', [], m('fName', r('sin')), e(r('θ'))),
      construct('limLow', [], e(r('lim')), m('lim', r('n→∞'))),
      construct('limUpp', [], e(r('X')), m('lim', r('T'))),
      construct('acc', [], e(r('o'))),
      construct('acc', [['chr', '\u0303']], e(r('n'))),
      construct('bar', [], e(r('z'))),
      construct('bar', [['pos', 'top']], e(r('w'))),
      construct('groupChr', [], e(r('g'))),
      construct('groupChr', [['chr', '\u23DE']], e(r('h'))),
      construct('m', [], m('mr', e(r('1')), e(r('2'))), m('mr', e(r('3')), e(r('4')))),
      construct('eqArr', [], e(r('s=1')), e(r('t=2'))),
      construct('phant', [['show', 'off']], e(r('hidden'))),
      construct('phant', [['show', 'false']], e(r('hidden'))),
      construct('phant', [['show', '0']], e(r('hidden'))),
      construct('phant', [], e(r('shown'))),
      m('box', r('B')),
      m('borderBox', r('D')),
    ),
  ),
);
