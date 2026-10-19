import { describe, expect, it } from 'vitest';
import { Deck, SlideImage } from './deck';

const bytes = new Uint8Array([1, 2, 3]);
const deck = {
  lectureId: 'lecture-1',
  lectureTitle: 'Lecture 1',
  mediaType: 'application/pdf',
  content: bytes,
};

describe('Deck', () => {
  it('parses a PDF deck', () => {
    expect(Deck.safeParse(deck).success).toBe(true);
  });

  it('refuses an empty file', () => {
    expect(Deck.safeParse({ ...deck, content: new Uint8Array() }).success).toBe(false);
  });

  it('refuses a media type that is not a deck, and a blank lecture title', () => {
    expect(Deck.safeParse({ ...deck, mediaType: 'image/png' }).success).toBe(false);
    expect(Deck.safeParse({ ...deck, lectureTitle: ' ' }).success).toBe(false);
  });
});

describe('SlideImage', () => {
  it('parses a PNG of a slide', () => {
    expect(
      SlideImage.safeParse({ slideNo: 1, mediaType: 'image/png', content: bytes }).success,
    ).toBe(true);
  });

  it('refuses slide zero and an empty image', () => {
    expect(
      SlideImage.safeParse({ slideNo: 0, mediaType: 'image/png', content: bytes }).success,
    ).toBe(false);
    expect(
      SlideImage.safeParse({ slideNo: 1, mediaType: 'image/png', content: new Uint8Array() })
        .success,
    ).toBe(false);
  });
});
