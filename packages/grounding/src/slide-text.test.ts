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

  it('has no title line for a slide without a title', () => {
    expect(slideLines(slide('l1/1', 'Only a body').record)).toEqual(['Only a body']);
  });
});
