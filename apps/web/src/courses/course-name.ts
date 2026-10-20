import { type CourseId, RouteCourseId } from '@cram/shared';

const MAX_LENGTH = 64;

/** A typed course name as the id the server files it under, or `undefined` when no id is left. */
export const courseIdFromName = (name: string): CourseId | undefined => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  const parsed = RouteCourseId.safeParse(slug);
  return parsed.success ? parsed.data : undefined;
};
