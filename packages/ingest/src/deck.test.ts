import { CourseId, LectureId, SourceHash } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { slidesFromPages, UNTITLED_LECTURE, type DeckSource } from './deck';
import type { PageText } from './page-text';

const source = (fileName = 'Lecture_04-Kinetics.pdf'): DeckSource => ({
  courseId: CourseId.parse('course-a'),
  lectureId: LectureId.parse('lecture-4'),
  fileName,
  sourceHash: SourceHash.parse('hash-4'),
});

const titled = (title: string, notes = ''): PageText => ({
  lines: [
    { text: title, size: 48 },
    { text: 'Rate laws relate rate to concentration', size: 28 },
  ],
  notes,
});
const blank: PageText = { lines: [], notes: '' };

describe('slidesFromPages', () => {
  it('ingests an empty deck as no slides', () => {
    expect(slidesFromPages([], source())).toEqual([]);
  });

  it('numbers slides from one in page order and stamps the deck on each', () => {
    const slides = slidesFromPages([titled('Kinetics'), titled('Rate laws')], source());
    expect(slides.map((record) => [record.slideNo, record.title])).toEqual([
      [1, 'Kinetics'],
      [2, 'Rate laws'],
    ]);
    for (const record of slides) {
      expect(record).toMatchObject({
        courseId: 'course-a',
        lectureId: 'lecture-4',
        lectureTitle: 'Kinetics',
        imageCaptions: [],
        derived: false,
        sourceHash: 'hash-4',
      });
    }
  });

  it('carries the page kind on its record', () => {
    expect(slidesFromPages([titled('Kinetics'), blank], source()).map(({ kind }) => kind)).toEqual([
      'content',
      'image-only',
    ]);
  });

  it('carries speaker notes, trimmed', () => {
    const [slide] = slidesFromPages([titled('Kinetics', '  Say this.\n')], source());
    expect(slide?.speakerNotes).toBe('Say this.');
  });

  it('stores every text of every page as storedText gives it, whichever adapter read it (#194)', () => {
    const [marked, inferred] = slidesFromPages(
      [
        {
          markedTitle: 'Energy 𝐸',
          lines: [{ text: 'Rest energy is 𝐸=𝑚𝑐^2 for a body at rest', size: 28 }],
          notes: 'Derive 𝑎\u0302.',
        },
        {
          lines: [
            { text: 'Cafe\u0301 kinetics', size: 48 },
            { text: 'Rate laws relate rate to 𝑘', size: 28 },
          ],
          notes: '',
        },
      ],
      source(),
    );
    expect(marked).toMatchObject({
      title: 'Energy E',
      body: 'Rest energy is E=mc^2 for a body at rest',
      speakerNotes: 'Derive \u00E2.',
    });
    expect(inferred).toMatchObject({
      title: 'Caf\u00E9 kinetics',
      body: 'Rate laws relate rate to k',
    });
  });

  it('takes the lecture title from the filename when the first page has none', () => {
    const [slide] = slidesFromPages(
      [blank, titled('Rate laws')],
      source('decks/Lecture_04-Kinetics.pdf'),
    );
    expect(slide?.lectureTitle).toBe('Lecture 04 Kinetics');
  });

  it('stores the filename lecture title as storedText gives it (#254)', () => {
    const [slide] = slidesFromPages([blank], source('Cafe\u0301_𝑘_rates.pdf'));
    expect(slide?.lectureTitle).toBe('Caf\u00E9 k rates');
  });

  it('takes a stored title verbatim over the filename when the first page has none (#299)', () => {
    const stored = { ...source('decks/Lecture_04-Kinetics.pdf'), storedTitle: 'Cells/Tissues_1-2' };
    expect(slidesFromPages([blank], stored)[0]?.lectureTitle).toBe('Cells/Tissues_1-2');
    expect(slidesFromPages([titled('Kinetics')], stored)[0]?.lectureTitle).toBe('Kinetics');
    expect(slidesFromPages([blank], { ...stored, storedTitle: '' })[0]?.lectureTitle).toBe(
      UNTITLED_LECTURE,
    );
  });

  it('falls back to a fixed lecture title when neither page nor filename has one', () => {
    const [slide] = slidesFromPages([blank], source('.pdf'));
    expect(slide?.lectureTitle).toBe(UNTITLED_LECTURE);
  });
});
