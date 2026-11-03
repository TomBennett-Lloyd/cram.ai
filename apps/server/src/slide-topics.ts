import type { TagRow } from '@cram/index';
import {
  type ChunkNo,
  chunkLines,
  type ChunkTag,
  type CourseId,
  type CourseUnavailableProblem,
  type EditedTags,
  type LectureId,
  type LectureSlides,
  type TagEdit,
  tagOrder,
} from '@cram/shared';
import { type CourseFiles, courseExists, openForWrite, openToRead } from './course-file';

/** A tag both origins hold is shown once, as the student's. */
export const chunkTags = (rows: readonly TagRow[], chunkNo: ChunkNo): ChunkTag[] => {
  const byTag = new Map<string, ChunkTag>();
  for (const { chunkNo: rowChunk, origin, tag } of rows)
    if (rowChunk === chunkNo && (origin === 'student' || !byTag.has(tag)))
      byTag.set(tag, { tag, origin });
  return [...byTag.values()].sort(tagOrder);
};

export type StoredLectureSlides =
  | { readonly status: 'found'; readonly slides: LectureSlides }
  | { readonly status: 'no-such-course' | 'no-such-lecture' }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

/** The lecture's slides, each chunk with its lines and tags (#428). */
export const storedLectureSlides = (
  files: CourseFiles,
  courseId: CourseId,
  lectureId: LectureId,
): StoredLectureSlides => {
  if (!courseExists(files, courseId)) return { status: 'no-such-course' };
  const opened = openToRead(files, courseId);
  if (opened.status === 'blank') return { status: 'no-such-lecture' };
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    if (!course.lectures().some((lecture) => lecture.lectureId === lectureId))
      return { status: 'no-such-lecture' };
    const slides = course.lectureSlides(lectureId).map(({ sourceId, record }) => {
      const rows = course.topics(sourceId);
      const chunks = course.chunks(sourceId).map((chunk) => ({
        chunkNo: chunk.chunkNo,
        lines: chunkLines(chunk).map(({ text }) => text),
        tags: chunkTags(rows, chunk.chunkNo),
      }));
      return { sourceId, record, chunks };
    });
    return { status: 'found', slides: { lectureId, slides } };
  } finally {
    course.close();
  }
};

export type TagEditOutcome =
  | { readonly status: 'edited'; readonly edited: EditedTags }
  | { readonly status: 'no-such-course' | 'no-such-fact' }
  | { readonly status: 'tags-changed'; readonly tags: ChunkTag[] }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

const sameTags = (base: readonly ChunkTag[], served: readonly ChunkTag[]): boolean => {
  const sorted = [...base].sort(tagOrder);
  return (
    sorted.length === served.length &&
    sorted.every(({ tag, origin }, index) => {
      const other = served[index];
      return other?.tag === tag && other.origin === origin;
    })
  );
};

/** Writes the chunk's whole tag list (`CourseIndex.editTopics`) if it still holds `base` (#507); the caller is `IngestQueue`, the file's one writer. */
export const editStoredTags = (
  files: CourseFiles,
  courseId: CourseId,
  { sourceId, chunkNo, base, tags }: TagEdit,
): TagEditOutcome => {
  if (!courseExists(files, courseId)) return { status: 'no-such-course' };
  const opened = openForWrite(files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    if (!course.chunks(sourceId).some((chunk) => chunk.chunkNo === chunkNo))
      return { status: 'no-such-fact' };
    const held = chunkTags(course.topics(sourceId), chunkNo);
    if (!sameTags(base, held)) return { status: 'tags-changed', tags: held };
    const set = course.editTopics({ sourceId, chunkNo }, tags);
    if (set.status === 'no-such-fact') return set;
    const stored = chunkTags(course.topics(sourceId), chunkNo);
    return { status: 'edited', edited: { sourceId, chunkNo, tags: stored } };
  } finally {
    course.close();
  }
};
