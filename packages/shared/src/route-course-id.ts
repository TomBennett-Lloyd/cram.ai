import { z } from 'zod';
import { CourseId } from './slide-record';

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** A course id as a route carries it: it names a file, so lowercase, file-safe and no device name. */
export const RouteCourseId = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'lowercase letters, digits and inner hyphens')
  .refine((id) => !WINDOWS_DEVICE_NAME.test(id), 'a Windows device name')
  .pipe(CourseId);
