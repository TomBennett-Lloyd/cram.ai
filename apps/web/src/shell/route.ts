import { type CourseId, RouteCourseId } from '@cram/shared';

/** Hash routes, so no screen's path can collide with the server's `/courses` API on one origin. */
export type Route =
  | { readonly screen: 'courses' }
  | { readonly screen: 'ask'; readonly courseId: CourseId }
  | { readonly screen: 'decks'; readonly courseId: CourseId }
  | { readonly screen: 'not-found' };

export type ScreenRoute = Exclude<Route, { readonly screen: 'not-found' }>;

const COURSE_HASH = /^#\/courses\/([^/]+)(\/decks)?$/;

export const routeOf = (hash: string): Route => {
  if (hash === '' || hash === '#' || hash === '#/') return { screen: 'courses' };
  const [, segment, decks] = COURSE_HASH.exec(hash) ?? [];
  const courseId = RouteCourseId.safeParse(segment);
  if (!courseId.success) return { screen: 'not-found' };
  return decks === undefined
    ? { screen: 'ask', courseId: courseId.data }
    : { screen: 'decks', courseId: courseId.data };
};

export const hrefOf = (route: ScreenRoute): string => {
  switch (route.screen) {
    case 'courses':
      return '#/';
    case 'ask':
      return `#/courses/${route.courseId}`;
    case 'decks':
      return `#/courses/${route.courseId}/decks`;
  }
};
