import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type EmbedderIdentity,
  openCourse,
  openCourseReadOnly,
  type OpenCourseResult,
  type ReadCourseResult,
} from '@cram/index';
import {
  CourseId,
  type CourseUnavailableProblem,
  type LectureId,
  type RebuildReportDismissed,
  type RebuildReportRevision,
  type SlideImage,
  type SlideNo,
  type StoredLectures,
} from '@cram/shared';
import { COURSE_FILE_EXTENSION, courseFilePath, coursesDirectory } from './data-directory';

export interface CourseFiles {
  readonly dataDir: string;
  readonly embedder: EmbedderIdentity;
}

export const courseExists = (files: CourseFiles, courseId: CourseId): boolean =>
  existsSync(courseFilePath(files.dataDir, courseId));

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const directoryEntries = (path: string): readonly string[] => {
  try {
    return readdirSync(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
};

/** The courses with a course file; a file whose name is not a course id is not one. */
export const storedCourses = (files: CourseFiles): readonly CourseId[] =>
  directoryEntries(coursesDirectory(files.dataDir)).flatMap((name) => {
    if (!name.endsWith(COURSE_FILE_EXTENSION)) return [];
    const parsed = CourseId.safeParse(name.slice(0, -COURSE_FILE_EXTENSION.length));
    return parsed.success ? [parsed.data] : [];
  });

/** Opens the course file, creating it and its directory when absent. */
export const openForWrite = (files: CourseFiles, courseId: CourseId): OpenCourseResult => {
  const path = courseFilePath(files.dataDir, courseId);
  mkdirSync(dirname(path), { recursive: true });
  return openCourse({ path, courseId, embedder: files.embedder });
};

/** Opens an existing course file through `openCourseReadOnly`; the caller has checked `courseExists`. */
export const openToRead = (files: CourseFiles, courseId: CourseId): ReadCourseResult =>
  openCourseReadOnly({
    path: courseFilePath(files.dataDir, courseId),
    courseId,
    embedder: files.embedder,
  });

const NO_LECTURES: StoredLectures = { state: 'read', lectures: [], report: { state: 'none' } };

/** What the course file holds; a course with no file yet, or a blank one, holds no lectures. */
export const storedLectures = (files: CourseFiles, courseId: CourseId): StoredLectures => {
  if (!courseExists(files, courseId)) return NO_LECTURES;
  const opened = openToRead(files, courseId);
  if (opened.status === 'blank') return NO_LECTURES;
  if (opened.status !== 'open') return { state: 'course-unavailable', problem: opened.status };
  try {
    const { course } = opened;
    return {
      state: 'read',
      lectures: [...course.lectures()],
      report: course.rebuildReport(),
    };
  } finally {
    opened.course.close();
  }
};

export type StoredSlideImage =
  | { readonly status: 'found'; readonly image: SlideImage }
  | { readonly status: 'no-such-course' }
  | { readonly status: 'no-such-image' }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

/** The slide's stored rendering; a blank file holds none, and a PPTX deck stores none yet (#169). */
export const storedSlideImage = (
  files: CourseFiles,
  courseId: CourseId,
  lectureId: LectureId,
  slideNo: SlideNo,
): StoredSlideImage => {
  if (!courseExists(files, courseId)) return { status: 'no-such-course' };
  const opened = openToRead(files, courseId);
  if (opened.status === 'blank') return { status: 'no-such-image' };
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  try {
    const image = opened.course.slideImage(lectureId, slideNo);
    return image === undefined ? { status: 'no-such-image' } : { status: 'found', image };
  } finally {
    opened.course.close();
  }
};

export type RebuildReportDismissal =
  | RebuildReportDismissed
  | { readonly status: 'no-such-course' | 'report-changed' }
  | { readonly status: 'course-unavailable'; readonly problem: CourseUnavailableProblem };

/**
 * The student has been told what a rebuild discarded (`docs/adr/0004-storage.md` § Decision (d)),
 * in the report `revision` names; `report-changed` leaves a later one for them to read (#299).
 */
export const dismissRebuildReport = (
  files: CourseFiles,
  courseId: CourseId,
  revision: RebuildReportRevision,
): RebuildReportDismissal => {
  if (!courseExists(files, courseId)) return { status: 'no-such-course' };
  const opened = openForWrite(files, courseId);
  if (opened.status !== 'open') return { status: 'course-unavailable', problem: opened.status };
  try {
    return { status: opened.course.dismissRebuildReport(revision) };
  } finally {
    opened.course.close();
  }
};
