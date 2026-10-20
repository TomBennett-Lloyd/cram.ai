import { describe, expect, it } from 'vitest';
import { DECK_FILE_ACCEPT, deckMediaType, lectureIdOf } from './deck-file';

describe('deckMediaType', () => {
  it('reads a PDF and a PowerPoint deck by extension, in any case', () => {
    expect(deckMediaType('l1.pdf')).toBe('application/pdf');
    expect(deckMediaType('L1.PPTX')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('knows no type for any other file, or one with no extension', () => {
    for (const name of ['l1.ppt', 'l1.key', 'l1', 'pdf', 'l1.pdf.zip'])
      expect(deckMediaType(name), name).toBeUndefined();
  });
});

describe('DECK_FILE_ACCEPT', () => {
  it('lists every extension deckMediaType reads, and only those', () => {
    const extensions = DECK_FILE_ACCEPT.split(',');
    expect(extensions).toEqual(['.pdf', '.pptx']);
    for (const extension of extensions) expect(deckMediaType(`l1${extension}`)).toBeDefined();
  });
});

describe('lectureIdOf', () => {
  it('names a lecture by its file’s stem', () => {
    expect(lectureIdOf('Lecture 4.pdf')).toBe('Lecture 4');
    expect(lectureIdOf('week.2.slides.pptx')).toBe('week.2.slides');
    expect(lectureIdOf('notes')).toBe('notes');
  });

  it('falls back to the whole name when the stem is blank', () => {
    expect(lectureIdOf('.pdf')).toBe('.pdf');
    expect(lectureIdOf('  .pdf')).toBe('  .pdf');
  });
});
