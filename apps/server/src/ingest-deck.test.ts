import { UNTITLED_LECTURE } from '@cram/ingest';
import { CourseId, LectureId } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { lectureDeck } from './ingest-deck';

describe('lectureDeck', () => {
  it('titles a deck with no slides as untitled rather than refuse to store it', () => {
    const job = {
      courseId: CourseId.parse('bio'),
      lectureId: LectureId.parse('l1'),
      fileName: 'empty.pptx',
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      bytes: new Uint8Array([1]),
    } as const;
    expect(lectureDeck(job, []).lectureTitle).toBe(UNTITLED_LECTURE);
  });
});
