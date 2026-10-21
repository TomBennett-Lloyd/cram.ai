import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type EmbedderIdentity, openCourse, type OpenCourseResult } from '@cram/index';
import { type CourseId, RouteCourseId } from '@cram/shared';
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

/** The courses with a course file; a file whose name is not a route course id is not one. */
export const storedCourses = (files: CourseFiles): readonly CourseId[] =>
  directoryEntries(coursesDirectory(files.dataDir)).flatMap((name) => {
    if (!name.endsWith(COURSE_FILE_EXTENSION)) return [];
    const parsed = RouteCourseId.safeParse(name.slice(0, -COURSE_FILE_EXTENSION.length));
    return parsed.success ? [parsed.data] : [];
  });

/** Opens the course file, creating it and its directory when absent. */
export const openForWrite = (files: CourseFiles, courseId: CourseId): OpenCourseResult => {
  const path = courseFilePath(files.dataDir, courseId);
  mkdirSync(dirname(path), { recursive: true });
  return openCourse({ path, courseId, embedder: files.embedder });
};

/** Opens an existing course file; the caller has checked `courseExists`. */
export const openForRead = (files: CourseFiles, courseId: CourseId): OpenCourseResult =>
  openCourse({
    path: courseFilePath(files.dataDir, courseId),
    courseId,
    embedder: files.embedder,
  });
