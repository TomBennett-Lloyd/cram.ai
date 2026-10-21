export type CourseRouteName = 'upload-deck' | 'ingest-status' | 'ask';

export type RouteMatch =
  | { readonly status: 'matched'; readonly route: 'list-courses' }
  | { readonly status: 'matched'; readonly route: CourseRouteName; readonly courseSegment: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'method-not-allowed'; readonly allow: string };

const COURSE_ROUTES = {
  decks: { route: 'upload-deck', method: 'POST' },
  ingest: { route: 'ingest-status', method: 'GET' },
  ask: { route: 'ask', method: 'POST' },
} as const;

export const COURSES_PATH = '/courses';
const COURSE_PATH = /^\/courses\/([^/]+)\/([^/]+)$/;

const isRouteKey = (key: string): key is keyof typeof COURSE_ROUTES =>
  Object.hasOwn(COURSE_ROUTES, key);

/** The course segment is returned undecoded; the course-id schema refuses anything encoded. */
export const matchRoute = (method: string | undefined, pathname: string): RouteMatch => {
  if (pathname === COURSES_PATH)
    return method === 'GET'
      ? { status: 'matched', route: 'list-courses' }
      : { status: 'method-not-allowed', allow: 'GET' };
  const [, courseSegment, resource] = COURSE_PATH.exec(pathname) ?? [];
  if (courseSegment === undefined || resource === undefined || !isRouteKey(resource))
    return { status: 'not-found' };
  const { route, method: allowed } = COURSE_ROUTES[resource];
  return method === allowed
    ? { status: 'matched', route, courseSegment }
    : { status: 'method-not-allowed', allow: allowed };
};
