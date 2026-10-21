import { describe, expect, it } from 'vitest';
import { quoteSpan, slideFields } from './quotable-text';
import { slide } from './slide-record-fixture';

/** The text `quote` spans in `text`, so one string states where it was found. */
const spanned = (text: string, quote: string): string | undefined => {
  const span = quoteSpan(text, quote);
  return span === undefined ? undefined : text.slice(span.start, span.end);
};

describe('quoteSpan', () => {
  it('finds a verbatim quote, end exclusive', () => {
    expect(quoteSpan('Bees build comb.', 'build')).toEqual({ start: 5, end: 10 });
  });

  it('reads a whitespace run in the text as the one space the quote has', () => {
    expect(spanned('drones  \n are male', 'drones are')).toBe('drones  \n are');
  });

  it('reads a line break or tab in the text as a space, and in the quote too', () => {
    expect(spanned('male.\nThe queen', 'male. The')).toBe('male.\nThe');
    expect(spanned('male. The\tqueen', 'The\nqueen')).toBe('The\tqueen');
  });

  it('gives indices into the original text after a collapsed run', () => {
    expect(quoteSpan('a  \n  b c', 'b c')).toEqual({ start: 6, end: 9 });
  });

  it('ignores whitespace around the quote', () => {
    expect(spanned('Bees build comb.', ' \n build comb\t')).toBe('build comb');
  });

  it('finds a quote at the very start and the very end', () => {
    expect(spanned('Bees build comb.', 'Bees')).toBe('Bees');
    expect(spanned('Bees build comb.', 'comb.')).toBe('comb.');
  });

  it('normalises nothing but whitespace', () => {
    expect(quoteSpan('the colony’s queen', "colony's")).toBeUndefined();
    expect(quoteSpan('Bees build comb.', 'bees')).toBeUndefined();
  });

  it('finds nothing for a quote the text does not hold, or a blank one', () => {
    expect(quoteSpan('Bees build comb.', 'Bees build hives')).toBeUndefined();
    expect(quoteSpan('Bees build comb.', ' \n ')).toBeUndefined();
    expect(quoteSpan('', 'Bees')).toBeUndefined();
  });
});

describe('slideFields', () => {
  it('reads title, body, speaker notes, then each image caption', () => {
    const record = slide({ speakerNotes: 'Say: queens lay.', imageCaptions: ['A comb', 'A cell'] });
    expect(slideFields(record)).toEqual([
      { field: 'title', text: 'The Hive' },
      { field: 'body', text: 'Worker bees are female.' },
      { field: 'speakerNotes', text: 'Say: queens lay.' },
      { field: 'imageCaption', text: 'A comb' },
      { field: 'imageCaption', text: 'A cell' },
    ]);
  });

  it('leaves out empty and whitespace-only fields', () => {
    const record = slide({ title: ' \n', speakerNotes: '', imageCaptions: ['', 'A comb'] });
    expect(slideFields(record)).toEqual([
      { field: 'body', text: 'Worker bees are female.' },
      { field: 'imageCaption', text: 'A comb' },
    ]);
  });
});
