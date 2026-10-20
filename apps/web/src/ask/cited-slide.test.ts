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
import { citedSlides } from './cited-slide';

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

describe('citedSlides', () => {
  const slides = [retrieved('s1'), retrieved('s2'), retrieved('s3')];

  it('groups a unit’s quotes by slide, in the order the unit first cites each', () => {
    const { cited, missing } = citedSlides(
      [cite('s2', 'a'), cite('s1', 'b'), cite('s2', 'c')],
      slides,
    );
    expect(cited.map(({ slide, quotes }) => [slide.sourceId, quotes])).toEqual([
      ['s2', ['a', 'c']],
      ['s1', ['b']],
    ]);
    expect(missing).toBe(0);
  });

  it('counts a citation naming no slide of the reply as missing', () => {
    const { cited, missing } = citedSlides(
      [cite('s9', 'a'), cite('s1', 'b'), cite('s9', 'c')],
      slides,
    );
    expect(cited.map(({ slide }) => slide.sourceId)).toEqual(['s1']);
    expect(missing).toBe(2);
  });
});
