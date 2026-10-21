import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { COURSE_ID_MAX_LENGTH as MAX, CourseId, SlideRecord } from './slide-record';

type SlideInput = z.input<typeof SlideRecord>;

const slide = (overrides: Partial<SlideInput> = {}): SlideInput => ({
  courseId: 'course-a',
  lectureId: 'lecture-1',
  lectureTitle: 'Lecture 1',
  slideNo: 1,
  kind: 'content',
  title: 'A title',
  body: 'A body',
  speakerNotes: '',
  imageCaptions: [],
  derived: false,
  sourceHash: 'hash-1',
  ...overrides,
});

describe('SlideRecord', () => {
  it('parses a slide with no extractable text', () => {
    const blank = slide({ title: '', body: '', speakerNotes: '', imageCaptions: [] });
    expect(SlideRecord.safeParse(blank).success).toBe(true);
  });

  it('refuses slide number zero, because slide numbers count from one', () => {
    expect(SlideRecord.safeParse(slide({ slideNo: 0 })).success).toBe(false);
  });

  it('refuses a fractional slide number', () => {
    expect(SlideRecord.safeParse(slide({ slideNo: 1.5 })).success).toBe(false);
  });

  it('refuses a blank lecture title', () => {
    expect(SlideRecord.safeParse(slide({ lectureTitle: '  ' })).success).toBe(false);
  });

  it('refuses a kind outside the slide-kind vocabulary', () => {
    expect(SlideRecord.safeParse({ ...slide(), kind: 'appendix' }).success).toBe(false);
  });

  it('refuses a slide with no kind', () => {
    const kindless: Partial<SlideInput> = slide();
    delete kindless.kind;
    expect(SlideRecord.safeParse(kindless).success).toBe(false);
  });

  it('refuses an empty lecture id', () => {
    expect(SlideRecord.safeParse(slide({ lectureId: '' })).success).toBe(false);
  });
});

describe('CourseId', () => {
  it('accepts lowercase letters and digits with inner hyphens, up to the maximum length', () => {
    for (const id of [
      'a',
      '7',
      'bio-101',
      'a-b-c',
      'x'.repeat(MAX),
      'com0',
      'lpt0',
      'lpt10',
      'console',
      'falcon',
      'telecom1',
    ])
      expect(CourseId.safeParse(id).success, id).toBe(true);
  });

  it('refuses anything else, a Windows device name included', () => {
    for (const id of [
      '',
      'Bio',
      '-bio',
      'bio-',
      'bio_101',
      'bio 101',
      'bio%20',
      'x'.repeat(MAX + 1),
      'con',
      'prn',
      'aux',
      'nul',
      'com1',
      'lpt9',
    ])
      expect(CourseId.safeParse(id).success, id).toBe(false);
  });
});
