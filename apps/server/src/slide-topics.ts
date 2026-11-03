import { type CourseReader, sourceIdOf, type TagRow, textHashOf } from '@cram/index';
import {
  type BrowsedChunk,
  type BrowsedSlide,
  type ChunkNo,
  chunkLines,
  type ChunkTag,
  type CourseId,
  type CourseUnavailableProblem,
  type EditedTags,
  type LectureId,
  type LectureSlides,
  type SourceId,
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

const browsedChunks = (course: CourseReader, sourceId: SourceId): BrowsedChunk[] => {
  const rows = course.topics(sourceId);
  return course.chunks(sourceId).map((chunk) => ({
    chunkNo: chunk.chunkNo,
    textHash: textHashOf(chunk),
    lines: chunkLines(chunk).map(({ text }) => text),
    tags: chunkTags(rows, chunk.chunkNo),
  }));
};

/** The lecture's slides, each chunk with its text's hash, lines and tags (#428). */
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
    const slides = course.lectureSlides(lectureId).map(({ sourceId, record }) => ({
      sourceId,
      record,
      chunks: browsedChunks(course, sourceId),
    }));
    return { status: 'found', slides: { lectureId, slides } };
  } finally {
    course.close();
  }
};

export type TagEditOutcome =
  | { readonly status: 'edited'; readonly edited: EditedTags }
  | { readonly status: 'no-such-course' | 'no-such-fact' }
  | { readonly status: 'chunk-changed'; readonly slide: BrowsedSlide }
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

const chunkChanged = (course: CourseReader, sourceId: SourceId): TagEditOutcome => {
  const record = course.slides().find((slide) => sourceIdOf(slide) === sourceId);
  if (record === undefined) return { status: 'no-such-fact' };
  return {
    status: 'chunk-changed',
    slide: { sourceId, record, chunks: browsedChunks(course, sourceId) },
  };
};

/** Writes the chunk's whole tag list (`CourseIndex.editTopics`) if it still holds the text (#534) and then the list (#507) the edit was made against; the caller is `IngestQueue`, the file's one writer. */
export const editStoredTags = (
  files: CourseFiles,
  courseId: CourseId,
  { sourceId, chunkNo, textHash, base, tags }: TagEdit,
): TagEditOutcome => {
  if (!courseExists(files, courseId)) return { status: 'no-such-course' };
  const opened = openForWrite(files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    const chunk = course.chunks(sourceId).find((each) => each.chunkNo === chunkNo);
    if (chunk === undefined || textHashOf(chunk) !== textHash)
      return chunkChanged(course, sourceId);
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
