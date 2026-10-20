import { z } from 'zod';
import { CourseId } from './slide-record';

/** Every course the server holds, in id order: one with a course file, or with an upload since it started. */
export const CourseList = z.strictObject({ courses: z.array(CourseId) });
export type CourseList = z.infer<typeof CourseList>;
