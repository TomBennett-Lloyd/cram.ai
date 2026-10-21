import { SlideRecord } from './slide-record';

/** A content slide with a title and a body, `fields` overriding any of it. */
export const slide = (fields: Partial<SlideRecord> = {}): SlideRecord =>
  SlideRecord.parse({
    courseId: 'bio',
    lectureId: 'l1',
    lectureTitle: 'Lecture 1',
    slideNo: 1,
    kind: 'content',
    title: 'The Hive',
    body: 'Worker bees are female.',
    speakerNotes: '',
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
    ...fields,
  });
