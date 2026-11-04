import { CourseId, LectureId } from '@cram/shared';

/** Hash routes, so no screen's path can collide with the server's `/courses` API on one origin. */
export type Route =
  | { readonly screen: 'courses' }
  | { readonly screen: 'ask'; readonly courseId: CourseId }
  | { readonly screen: 'decks'; readonly courseId: CourseId }
  | { readonly screen: 'slides'; readonly courseId: CourseId; readonly lectureId: LectureId }
  | { readonly screen: 'not-found' };

export type ScreenRoute = Exclude<Route, { readonly screen: 'not-found' }>;

const COURSE_HASH = /^#\/courses\/([^/]+)(\/decks(?:\/([^/]+))?)?$/;

const lectureOf = (segment: string): LectureId | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
  const lectureId = LectureId.safeParse(decoded);
  return lectureId.success ? lectureId.data : undefined;
};

export const routeOf = (hash: string): Route => {
  if (hash === '' || hash === '#' || hash === '#/') return { screen: 'courses' };
  const [, segment, decks, lecture] = COURSE_HASH.exec(hash) ?? [];
  const parsed = CourseId.safeParse(segment);
  if (!parsed.success) return { screen: 'not-found' };
  const courseId = parsed.data;
  if (decks === undefined) return { screen: 'ask', courseId };
  if (lecture === undefined) return { screen: 'decks', courseId };
  const lectureId = lectureOf(lecture);
  return lectureId === undefined
    ? { screen: 'not-found' }
    : { screen: 'slides', courseId, lectureId };
};

export const hrefOf = (route: ScreenRoute): string => {
  switch (route.screen) {
    case 'courses':
      return '#/';
    case 'ask':
      return `#/courses/${route.courseId}`;
    case 'decks':
      return `#/courses/${route.courseId}/decks`;
    case 'slides':
      return `#/courses/${route.courseId}/decks/${encodeURIComponent(route.lectureId)}`;
  }
};
