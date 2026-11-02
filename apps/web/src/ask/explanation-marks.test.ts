import { type Explanation, SourceId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { markExplanation, sourceNumbers } from './explanation-marks';

const id = (value: string) => SourceId.parse(value);

/** A sentence: its text, its slides, and the ones it is marked against. */
type Row = readonly [string, readonly string[], (readonly string[])?];

const explanation = (
  text: string,
  sentences: readonly Row[],
  quotes: readonly (readonly [string, string])[] = [],
): Explanation => ({
  text,
  quotes: quotes.map(([sourceId, quote]) => ({ sourceId: id(sourceId), quote })),
  sentences: sentences.map(([sentence, slides, contradicts = []]) => ({
    text: sentence,
    slides: slides.map(id),
    contradicts: contradicts.map(id),
  })),
  sources: [id('s1')],
});

/** Each sentence's runs, a quoted run written `[text|sourceId]`, `+` after the one its number follows. */
const runs = (value: Explanation) =>
  markExplanation(value).map((sentence) =>
    sentence.runs
      .map(({ text, quote }) =>
        quote === undefined ? text : `[${text}|${quote.sourceId}${quote.ends ? '+' : ''}]`,
      )
      .join(''),
  );

describe('markExplanation', () => {
  it('marks a quote at a sentence’s start, middle and end, and leaves a sentence with none whole', () => {
    const text = 'Drones are male. They say workers forage daily. Cells are hexagonal.';
    expect(
      runs(
        explanation(
          text,
          [
            ['Drones are male.', []],
            ['They say workers forage daily.', []],
            ['Cells are hexagonal.', []],
          ],
          [
            ['s1', 'Drones'],
            ['s2', 'workers forage'],
            ['s3', 'hexagonal.'],
          ],
        ),
      ),
    ).toEqual([
      '[Drones|s1+] are male.',
      'They say [workers forage|s2+] daily.',
      'Cells are [hexagonal.|s3+]',
    ]);
  });

  it('marks a quote crossing a sentence boundary in each sentence, its number after the last', () => {
    const text = 'Drones are male. Workers are female. Cells are hexagonal.';
    const value = explanation(
      text,
      [
        ['Drones are male.', []],
        ['Workers are female.', []],
        ['Cells are hexagonal.', []],
      ],
      [['s1', 'male. Workers are female. Cells']],
    );
    expect(runs(value)).toEqual([
      'Drones are [male.|s1]',
      '[Workers are female.|s1]',
      '[Cells|s1+] are hexagonal.',
    ]);
  });

  it('reads whitespace runs as one space, in the sentence and in the quote', () => {
    const text = 'Drones  are\nmale.\n\nWorkers are   female.';
    const value = explanation(
      text,
      [
        ['Drones are male.', []],
        ['Workers are female.', []],
      ],
      [['s1', 'are male.  Workers']],
    );
    expect(runs(value)).toEqual(['Drones  [are\nmale.|s1]', '[Workers|s1+] are   female.']);
  });

  it('finds a repeated sentence past the one before it, and its quote in the first only', () => {
    const value = explanation(
      'Drones are male. Drones are male.',
      [
        ['Drones are male.', []],
        ['Drones are male.', []],
      ],
      [['s1', 'male']],
    );
    expect(runs(value)).toEqual(['Drones are [male|s1+].', 'Drones are male.']);
  });

  it('shows a sentence the text does not hold as its own words, unmarked', () => {
    const value = explanation(
      'Drones are male.',
      [
        ['Queens are fed jelly.', []],
        ['Drones are male.', []],
      ],
      [['s1', 'jelly']],
    );
    expect(runs(value)).toEqual(['Queens are fed jelly.', 'Drones are male.']);
  });

  it('leaves unmarked a quote the text does not hold, and one overlapping an earlier quote', () => {
    const text = 'Drones are male and do not forage.';
    const value = explanation(
      text,
      [[text, []]],
      [
        ['s3', 'do not forage'],
        ['s1', 'Drones are male'],
        ['s2', 'male and do'],
        ['s4', 'Queens'],
      ],
    );
    expect(runs(value)).toEqual(['[Drones are male|s1+] and [do not forage|s3+].']);
  });

  it('marks two quotes that touch as two', () => {
    const text = 'Drones are male.';
    expect(
      runs(
        explanation(
          text,
          [[text, []]],
          [
            ['s1', 'Drones are'],
            ['s2', 'male.'],
          ],
        ),
      ),
    ).toEqual(['[Drones are|s1+] [male.|s2+]']);
    expect(
      runs(
        explanation(
          'Drones aremale.',
          [['Drones aremale.', []]],
          [
            ['s1', 'Drones are'],
            ['s2', 'male.'],
          ],
        ),
      ),
    ).toEqual(['[Drones are|s1+][male.|s2+]']);
  });

  it('puts a slide in both arrays in the contradiction group only, each group in its own order', () => {
    const value = explanation('Drones forage.', [
      ['Drones forage.', ['s3', 's1', 's2', 's4'], ['s2', 's1']],
    ]);
    const [sentence] = markExplanation(value);
    expect(sentence?.contradicts).toEqual([id('s2'), id('s1')]);
    expect(sentence?.mayBeRelevant).toEqual([id('s3'), id('s4')]);
  });

  it('gives a sentence with no contradiction an empty group and every slide as may be relevant', () => {
    const [sentence] = markExplanation(explanation('Drones forage.', [['Drones forage.', ['s1']]]));
    expect(sentence?.contradicts).toEqual([]);
    expect(sentence?.mayBeRelevant).toEqual([id('s1')]);
  });
});

describe('sourceNumbers', () => {
  it('numbers each source from 1 by its place in sources', () => {
    expect([...sourceNumbers([id('s2'), id('s1'), id('s3')])]).toEqual([
      [id('s2'), 1],
      [id('s1'), 2],
      [id('s3'), 3],
    ]);
  });
});
