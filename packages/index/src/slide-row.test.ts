import { LectureId, SlideNo } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { sourceIdOf } from './slide-row';

const id = (lecture: string, slide: number) =>
  sourceIdOf({ lectureId: LectureId.parse(lecture), slideNo: SlideNo.parse(slide) });

describe('sourceIdOf', () => {
  it('names the lecture and the slide number', () => {
    expect(id('lecture-4', 12)).toBe('lecture-4/12');
  });

  it('keeps two slides apart when a lecture id itself contains a slash', () => {
    expect(id('a/1', 2)).not.toBe(id('a', 12));
    expect(id('a/1', 2)).not.toBe(id('a/12', 1));
  });
});
