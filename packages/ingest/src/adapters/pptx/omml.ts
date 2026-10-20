import type { Element } from '@xmldom/xmldom';
import { NS } from './ooxml';

type Read = (element: Element) => string;
/** A construct's linear form, given the reader for its arguments. */
type Construct = (element: Element, read: Read) => string;

const childrenOf = (element: Element): Element[] => [...element.children];

const childNamed = (element: Element | undefined, name: string): Element | undefined =>
  element === undefined ? undefined : childrenOf(element).find((child) => child.localName === name);

const childrenNamed = (element: Element, name: string): Element[] =>
  childrenOf(element).filter((child) => child.localName === name);

/** A property's `m:val`; an absent property takes ECMA-376 Part 1 § 22.1.2's default, while an empty value means no character. */
const propertyOf = (element: Element, properties: string, name: string, fallback: string): string =>
  childNamed(childNamed(element, properties), name)?.getAttributeNS(NS.m, 'val') ?? fallback;

const sequence: Construct = (element, read) => childrenOf(element).map(read).join('');

const argument = (element: Element, name: string, read: Read): string => {
  const child = childNamed(element, name);
  return child === undefined ? '' : read(child);
};

/** `ST_OnOff`'s false values (ECMA-376 Part 1 § 22.9.2.7). */
const OFF: ReadonlySet<string> = new Set(['off', 'false', '0']);

/** A run of letters and digits, or one character. */
const ATOM = /^(?:[\p{L}\p{N}]+|.)$/u;

/** One delimiter group alone needs no brackets of its own. */
const isDelimited = (child: Element | undefined, read: Read): boolean => {
  const shown = child === undefined ? [] : childrenOf(child).filter((c) => read(c) !== '');
  return shown.length === 1 && shown[0]?.localName === 'd';
};

/** An operand is bracketed unless it is an atom or one delimiter group. */
const operand = (element: Element, name: string, read: Read): string => {
  const text = argument(element, name, read);
  return ATOM.test(text) || isDelimited(childNamed(element, name), read) ? text : `(${text})`;
};

/** An empty script is omitted with its operator. */
const script = (element: Element, name: string, operator: string, read: Read): string =>
  argument(element, name, read) === '' ? '' : `${operator}${operand(element, name, read)}`;

/**
 * Each construct's linear form, borrowed from UnicodeMath (Unicode Technical Note #28). An element
 * absent here reads as its children in order: arguments (`m:e`, `m:num`, …), runs, the wrappers
 * `m:box` and `m:borderBox`, and properties, which hold no `m:t`.
 */
const CONSTRUCTS: ReadonlyMap<string, Construct> = new Map<string, Construct>([
  ['t', (element) => element.textContent ?? ''],
  ['oMathPara', (element, read) => childrenNamed(element, 'oMath').map(read).join(' ')],
  [
    'f',
    (element, read) =>
      `${operand(element, 'num', read)}${propertyOf(element, 'fPr', 'type', 'bar') === 'noBar' ? '¦' : '/'}${operand(element, 'den', read)}`,
  ],
  ['sSup', (element, read) => `${operand(element, 'e', read)}${script(element, 'sup', '^', read)}`],
  ['sSub', (element, read) => `${operand(element, 'e', read)}${script(element, 'sub', '_', read)}`],
  [
    'sSubSup',
    (element, read) =>
      `${operand(element, 'e', read)}${script(element, 'sub', '_', read)}${script(element, 'sup', '^', read)}`,
  ],
  [
    'sPre',
    (element, read) =>
      `${script(element, 'sub', '_', read)}${script(element, 'sup', '^', read)} ${operand(element, 'e', read)}`,
  ],
  [
    'rad',
    (element, read) => {
      const degree = argument(element, 'deg', read);
      return degree === ''
        ? `√${operand(element, 'e', read)}`
        : `√(${degree}&${argument(element, 'e', read)})`;
    },
  ],
  [
    'nary',
    (element, read) =>
      `${propertyOf(element, 'naryPr', 'chr', '∫')}${script(element, 'sub', '_', read)}${script(element, 'sup', '^', read)} ${argument(element, 'e', read)}`,
  ],
  [
    'd',
    (element, read) =>
      `${propertyOf(element, 'dPr', 'begChr', '(')}${childrenNamed(element, 'e')
        .map(read)
        .join(
          propertyOf(element, 'dPr', 'sepChr', '|'),
        )}${propertyOf(element, 'dPr', 'endChr', ')')}`,
  ],
  [
    'func',
    (element, read) => `${argument(element, 'fName', read)} ${argument(element, 'e', read)}`,
  ],
  [
    'limLow',
    (element, read) => `${operand(element, 'e', read)}${script(element, 'lim', '_', read)}`,
  ],
  [
    'limUpp',
    (element, read) => `${operand(element, 'e', read)}${script(element, 'lim', '^', read)}`,
  ],
  [
    'acc',
    (element, read) =>
      `${operand(element, 'e', read)}${propertyOf(element, 'accPr', 'chr', '\u0302')}`,
  ],
  [
    'bar',
    (element, read) =>
      `${operand(element, 'e', read)}${propertyOf(element, 'barPr', 'pos', 'bot') === 'top' ? '\u0305' : '\u0332'}`,
  ],
  [
    'groupChr',
    (element, read) =>
      `${propertyOf(element, 'groupChrPr', 'chr', '\u23DF')}${operand(element, 'e', read)}`,
  ],
  [
    'm',
    (element, read) =>
      childrenNamed(element, 'mr')
        .map((row) => childrenNamed(row, 'e').map(read).join(', '))
        .join('; '),
  ],
  ['eqArr', (element, read) => childrenNamed(element, 'e').map(read).join('; ')],
  /** A phantom shown off takes space on the slide but shows nothing, so it reads as nothing. */
  [
    'phant',
    (element, read) =>
      OFF.has(propertyOf(element, 'phantPr', 'show', 'on')) ? '' : argument(element, 'e', read),
  ],
]);

/** An `a14:m` equation as one line of text, so a quote can cite it verbatim (#126). */
export const linearOmml = (equation: Element): string => {
  /** Each element is read once: an operand is read again to bracket it, which would otherwise compound with depth. */
  const texts = new Map<Element, string>();
  const read: Read = (element) => {
    const cached = texts.get(element);
    if (cached !== undefined) return cached;
    const text = (CONSTRUCTS.get(element.localName ?? '') ?? sequence)(element, read);
    texts.set(element, text);
    return text;
  };
  return sequence(equation, read);
};
