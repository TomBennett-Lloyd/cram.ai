import { describe, expect, it } from 'vitest';
import { slide } from './fake-gateway-fixture';
import { slideLines } from './slide-text';

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
