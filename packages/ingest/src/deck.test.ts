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

  it('takes the lecture title from the filename when the first page has none', () => {
    const [slide] = slidesFromPages(
      [blank, titled('Rate laws')],
      source('decks/Lecture_04-Kinetics.pdf'),
    );
    expect(slide?.lectureTitle).toBe('Lecture 04 Kinetics');
  });

  it('falls back to a fixed lecture title when neither page nor filename has one', () => {
    const [slide] = slidesFromPages([blank], source('.pdf'));
    expect(slide?.lectureTitle).toBe(UNTITLED_LECTURE);
  });
});
