import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type CourseReader,
  type EmbedderIdentity,
  type LectureKey,
  openCourse,
  openCourseReadOnly,
  type OpenCourseResult,
  type ReadCourseResult,
} from '@cram/index';
import {
  CourseId,
  type CourseSummaries,
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

export const storedCourses = (files: CourseFiles): readonly CourseId[] =>
  directoryEntries(coursesDirectory(files.dataDir)).flatMap((name) => {
    if (!name.endsWith(COURSE_FILE_EXTENSION)) return [];
    const parsed = CourseId.safeParse(name.slice(0, -COURSE_FILE_EXTENSION.length));
    return parsed.success ? [parsed.data] : [];
  });

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

interface ReadOutcomes<T> {
  readonly empty: T;
  readonly unavailable: (problem: CourseUnavailableProblem) => T;
}

/** A course with no file yet, or a blank one, is `empty`. */
const readCourseFile = <T>(
  files: CourseFiles,
  courseId: CourseId,
  outcomes: ReadOutcomes<T>,
  read: (course: CourseReader) => T,
): T => {
  if (!courseExists(files, courseId)) return outcomes.empty;
  const opened = openToRead(files, courseId);
  if (opened.status === 'blank') return outcomes.empty;
  if (opened.status !== 'open') return outcomes.unavailable(opened.status);
  try {
    return read(opened.course);
  } finally {
    opened.course.close();
  }
};

const NO_LECTURES: StoredLectures = { state: 'read', lectures: [], report: { state: 'none' } };

export const storedLectures = (files: CourseFiles, courseId: CourseId): StoredLectures =>
  readCourseFile<StoredLectures>(
    files,
    courseId,
    { empty: NO_LECTURES, unavailable: (problem) => ({ state: 'course-unavailable', problem }) },
    (course) => ({
      state: 'read',
      lectures: [...course.lectures()],
      report: course.rebuildReport(),
    }),
  );

/** The key a log line names the lecture by; none for a lecture or course file the server cannot read. */
export const lectureKeyOf = (
  files: CourseFiles,
  courseId: CourseId,
  lectureId: LectureId,
): LectureKey | undefined =>
  readCourseFile(files, courseId, { empty: undefined, unavailable: () => undefined }, (course) =>
    course.lectureKey(lectureId),
  );

const NO_SUMMARIES: CourseSummaries = { state: 'read', summaries: [], slides: [] };

/** Every stored summary, with each slide its lines cite; the caller has checked `courseExists`. */
export const storedSummaries = (files: CourseFiles, courseId: CourseId): CourseSummaries => {
  const opened = openToRead(files, courseId);
  if (opened.status === 'blank') return NO_SUMMARIES;
  if (opened.status !== 'open') return { state: 'course-unavailable', problem: opened.status };
  const { course } = opened;
  try {
    const summaries = course.summaries();
    const cited = new Set(
      summaries.flatMap(({ units }) =>
        units.flatMap(({ citations }) => citations.map(({ sourceId }) => sourceId)),
      ),
    );
    const slides = summaries.flatMap(({ lectureId }) =>
      course.lectureSlides(lectureId).filter(({ sourceId }) => cited.has(sourceId)),
    );
    return { state: 'read', summaries: [...summaries], slides };
  } finally {
    course.close();
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
