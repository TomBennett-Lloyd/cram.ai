import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { SlideRecord } from './slide-record';

type SlideInput = z.input<typeof SlideRecord>;

const slide = (overrides: Partial<SlideInput> = {}): SlideInput => ({
  courseId: 'course-a',
  lectureId: 'lecture-1',
  lectureTitle: 'Lecture 1',
  slideNo: 1,
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

  it('refuses an empty lecture id', () => {
    expect(SlideRecord.safeParse(slide({ lectureId: '' })).success).toBe(false);
  });
});
