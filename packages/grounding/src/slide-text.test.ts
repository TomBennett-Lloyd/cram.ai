import { describe, expect, it } from 'vitest';
import { slide } from './fake-gateway-fixture';
import { copiedLine, copiedLines, slideLines } from './slide-text';

describe('slideLines', () => {
  it('reads the title, then each body and notes line, then each caption, trimmed and blanks left out', () => {
    const { record } = slide('l1/1', ' Smoke calms. It masks scent. \n\nWear a veil', {
      title: 'Stings',
      speakerNotes: 'Ask about veils.\n ',
      imageCaptions: ['A veil', ' '],
    });
    expect(slideLines(record)).toEqual([
      'Stings',
      'Smoke calms. It masks scent.',
      'Wear a veil',
      'Ask about veils.',
      'A veil',
    ]);
  });

  it('splits a title and a caption that hold a newline into a line each', () => {
    const { record } = slide('l1/1', 'Body', {
      title: 'Castes\nof the hive',
      imageCaptions: ['A\nB'],
    });
    expect(slideLines(record)).toEqual(['Castes', 'of the hive', 'Body', 'A', 'B']);
  });

  it('has no title line for a slide without a title', () => {
    expect(slideLines(slide('l1/1', 'Only a body').record)).toEqual(['Only a body']);
  });
});

describe('copiedLine', () => {
  const { record } = slide('l1/1', 'Castes\nWorker bees  are female.\nThe queen’s mating flight', {
    title: 'Castes',
    speakerNotes: 'Drones are male.',
  });

  it('finds the line a copy equals, as the slide holds it', () => {
    expect(copiedLine(record, 'Drones are male.')).toBe('Drones are male.');
    expect(copiedLine(record, 'Worker bees  are female.')).toBe('Worker bees  are female.');
  });

  it('reads whitespace runs on either side as one space, and ignores whitespace at the ends', () => {
    expect(copiedLine(record, ' Worker bees are\tfemale. ')).toBe('Worker bees  are female.');
    expect(copiedLine(record, 'Drones  are\n male.')).toBe('Drones are male.');
  });

  it('finds no line for a line the slide holds twice', () => {
    expect(copiedLines(record, 'Castes')).toEqual(['Castes', 'Castes']);
    expect(copiedLine(record, 'Castes')).toBeUndefined();
  });

  it.each([
    ['altered at its start', 'Brones are male.'],
    ['altered in its middle', 'Drones are mile.'],
    ['altered at its end', 'Drones are male'],
    ['in another case', 'drones are male.'],
    ['with a straight apostrophe for a curly one', "The queen's mating flight"],
    ['of part of a line', 'Drones are'],
    ['of two lines', 'Worker bees are female. The queen’s mating flight'],
    ['in quotation marks', '"Drones are male."'],
    ['behind a line number', '[5] Drones are male.'],
    ['that is blank', ' '],
  ])('finds no line for a copy %s', (_, copy) => {
    expect(copiedLines(record, copy)).toEqual([]);
    expect(copiedLine(record, copy)).toBeUndefined();
  });
});
