import { describe, expect, it } from 'vitest';
import { markExplanation, paragraphsOf } from './explanation-marks';
import { explanation, runs } from './explanation-marks-fixture';

/** Each sentence's `opensParagraph`, for a text and the sentences located in it. */
const opens = (text: string, sentences: readonly string[]) =>
  markExplanation(
    explanation(
      text,
      sentences.map((sentence) => [sentence, []]),
    ),
  ).map((sentence) => sentence.opensParagraph);

/**
 * The gap between two sentences, and whether cmark-gfm reads it as a paragraph break: each verdict
 * recorded from GitHub's `POST /markdown` (mode `markdown`) on `Alpha.<gap>Beta.`, 2026-11-03 (#466).
 */
const GAPS: readonly (readonly [string, boolean])[] = [
  [' ', false],
  ['\n', false],
  [' \n ', false],
  ['\n\n', true],
  ['\n \n', true],
  ['\n\t\n', true],
  ['\n \t \n', true],
  ['\n\n\n', true],
  ['  \n\n  ', true],
  ['\r\n', false],
  ['\r\n\r\n', true],
  ['\r', false],
  ['\r\r', true],
  ['\n\r', true],
  ['\r\n\r', true],
  ['\r\n \r\n', true],
  ['\r \r', true],
  ['\n\u00a0\n', false],
  ['\n\f\n', false],
  ['\n\u000b\n', false],
  ['\f\f', false],
  ['\u2028', false],
  ['\u2029', false],
  ['\u2029\u2029', false],
  ['\u0085\u0085', false],
  ['\n\u3000\n', false],
  ['\n\u200b\n', false],
];

describe('opensParagraph', () => {
  it.each(GAPS)('reads the gap %j as a paragraph break: %s', (gap, breaks) => {
    expect(opens(`Alpha.${gap}Beta.`, ['Alpha.', 'Beta.'])).toEqual([false, breaks]);
  });

  it('opens a paragraph at every sentence a blank line precedes, and never at the first', () => {
    expect(
      opens('\n\nDrones are male. Workers are female.\n\nCells are hexagonal.\n \nBees fly.', [
        'Drones are male.',
        'Workers are female.',
        'Cells are hexagonal.',
        'Bees fly.',
      ]),
    ).toEqual([false, false, true, true]);
  });

  it('reads the gap from the last sentence the text holds, past one it does not', () => {
    expect(opens('Drones.\n\nBees.', ['Drones.', 'Queens.', 'Bees.'])).toEqual([
      false,
      false,
      true,
    ]);
    expect(opens('Drones.\n\nBees. Cells.', ['Drones.', 'Bees.', 'Cells.'])).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('opens a paragraph at the sentence after a heading the claim split ends at a blank line', () => {
    expect(opens('Castes\n\nDrones are male.', ['Castes', 'Drones are male.'])).toEqual([
      false,
      true,
    ]);
  });

  it('opens none at a blank line inside a sentence, nor at a sentence the text does not hold', () => {
    expect(opens('Castes\n\nDrones are male.', ['Castes\n\nDrones are male.'])).toEqual([false]);
    expect(opens('Drones.\n\nBees.', ['Drones.', 'Queens.'])).toEqual([false, false]);
    expect(
      opens('Bees fly. Castes\n\nDrones are male.', ['Bees fly.', 'Castes\n\nDrones are male.']),
    ).toEqual([false, false]);
    expect(
      opens('Castes\n\nDrones are male. Workers.', ['Castes\n\nDrones are male.', 'Workers.']),
    ).toEqual([false, false]);
  });

  it('keeps a quote across a paragraph break marked in each paragraph, its number after the last', () => {
    const value = explanation(
      'Drones are male.\n\nWorkers are female.',
      [
        ['Drones are male.', []],
        ['Workers are female.', []],
      ],
      [['s1', 'male. Workers']],
    );
    expect(runs(value)).toEqual(['Drones are [male.|s1]', '[Workers|s1+] are female.']);
    expect(markExplanation(value).map((sentence) => sentence.opensParagraph)).toEqual([
      false,
      true,
    ]);
  });
});

describe('paragraphsOf', () => {
  it('starts a paragraph at the first sentence and at each that opens one', () => {
    const marked = markExplanation(
      explanation('A. B.\n\nC.\n\nD. E.', [
        ['A.', []],
        ['B.', []],
        ['C.', []],
        ['D.', []],
        ['E.', []],
      ]),
    );
    expect(
      paragraphsOf(marked).map((paragraph) => paragraph.map((sentence) => sentence.text)),
    ).toEqual([['A.', 'B.'], ['C.'], ['D.', 'E.']]);
  });

  it('gives no paragraphs for no sentences, and one for a first sentence that claims to open one', () => {
    expect(paragraphsOf([])).toEqual([]);
    const [first] = markExplanation(explanation('A.', [['A.', []]]));
    if (first === undefined) throw new Error('no sentence');
    expect(paragraphsOf([{ ...first, opensParagraph: true }])).toHaveLength(1);
  });
});
