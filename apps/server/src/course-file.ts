import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type EmbedderIdentity, openCourse, type OpenCourseResult } from '@cram/index';
import { CourseId } from '@cram/shared';
import { z } from 'zod';
import { courseFilePath } from './data-directory';

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** A course id as a route carries it: it names a file, so lowercase, file-safe and no device name. */
export const RouteCourseId = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'lowercase letters, digits and inner hyphens')
  .refine((id) => !WINDOWS_DEVICE_NAME.test(id), 'a Windows device name')
  .pipe(CourseId);

export interface CourseFiles {
  readonly dataDir: string;
  readonly embedder: EmbedderIdentity;
}

export const courseExists = (files: CourseFiles, courseId: CourseId): boolean =>
  existsSync(courseFilePath(files.dataDir, courseId));

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
