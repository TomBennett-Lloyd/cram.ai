import {
  type Citation,
  CourseId,
  LectureId,
  type RetrievedSlide,
  SlideNo,
  SourceHash,
  SourceId,
} from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { citedSlide } from './cited-slide';

const retrieved = (id: string): RetrievedSlide => ({
  sourceId: SourceId.parse(id),
  record: {
    courseId: CourseId.parse('bio'),
    lectureId: LectureId.parse('l1'),
    lectureTitle: 'Lecture 1',
    slideNo: SlideNo.parse(1),
    kind: 'content',
    title: id,
    body: '',
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: SourceHash.parse('h'),
  },
});

const cite = (sourceId: string, quote: string): Citation => ({
  sourceId: SourceId.parse(sourceId),
  quote,
});

describe('citedSlide', () => {
  const slides = [retrieved('s1'), retrieved('s2'), retrieved('s3')];
  const id = (value: string) => SourceId.parse(value);

  it('gives the slide with every quote the explanation takes from it, in order', () => {
    const quotes = [cite('s2', 'a'), cite('s3', 'b'), cite('s2', 'c')];
    expect(citedSlide(id('s2'), quotes, slides)).toEqual({ slide: slides[1], quotes: ['a', 'c'] });
    expect(citedSlide(id('s1'), quotes, slides)?.quotes).toEqual([]);
  });

  it('gives nothing for a slide the reply does not carry', () => {
    expect(citedSlide(id('s9'), [cite('s9', 'a')], slides)).toBeUndefined();
  });
});
