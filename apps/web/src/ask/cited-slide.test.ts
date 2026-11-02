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
import { sentenceSlides } from './cited-slide';

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

const sentence = (...ids: string[]) => ({
  text: 'Drones are male.',
  slides: ids.map((id) => SourceId.parse(id)),
  contradicts: [],
});

describe('sentenceSlides', () => {
  const slides = [retrieved('s1'), retrieved('s2'), retrieved('s3')];

  it('gives a sentence’s slides in its order, each with the explanation’s quotes from it', () => {
    const { cited, missing } = sentenceSlides(
      sentence('s2', 's1'),
      [cite('s2', 'a'), cite('s3', 'b'), cite('s2', 'c')],
      slides,
    );
    expect(cited.map(({ slide, quotes }) => [slide.sourceId, quotes])).toEqual([
      ['s2', ['a', 'c']],
      ['s1', []],
    ]);
    expect(missing).toBe(0);
  });

  it('counts a slide the reply does not carry as missing', () => {
    const { cited, missing } = sentenceSlides(sentence('s9', 's1', 's8'), [], slides);
    expect(cited.map(({ slide }) => slide.sourceId)).toEqual(['s1']);
    expect(missing).toBe(2);
  });
});
