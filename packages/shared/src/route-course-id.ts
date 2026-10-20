import { z } from 'zod';
import { CourseId } from './slide-record';

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** The longest course id a route carries; its carriers are `.claude/ledgers/route-course-id-length.ledger`. */
export const ROUTE_COURSE_ID_MAX_LENGTH = 64;

const ROUTE_COURSE_ID = new RegExp(
  `^[a-z0-9](?:[a-z0-9-]{0,${String(ROUTE_COURSE_ID_MAX_LENGTH - 2)}}[a-z0-9])?$`,
);

/** A course id as a route carries it: it names a file, so lowercase, file-safe and no device name. */
export const RouteCourseId = z
  .string()
  .regex(ROUTE_COURSE_ID, 'lowercase letters, digits and inner hyphens')
  .refine((id) => !WINDOWS_DEVICE_NAME.test(id), 'a Windows device name')
  .pipe(CourseId);
