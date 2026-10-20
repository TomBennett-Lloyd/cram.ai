export type RouteName = 'upload-deck' | 'ingest-status' | 'ask';

export type RouteMatch =
  | { readonly status: 'matched'; readonly route: RouteName; readonly courseSegment: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'method-not-allowed'; readonly allow: string };

const ROUTES = {
  decks: { route: 'upload-deck', method: 'POST' },
  ingest: { route: 'ingest-status', method: 'GET' },
  ask: { route: 'ask', method: 'POST' },
} as const;

const COURSE_PATH = /^\/courses\/([^/]+)\/([^/]+)$/;

const isRouteKey = (key: string): key is keyof typeof ROUTES => Object.hasOwn(ROUTES, key);

/** The course segment is returned undecoded; the course-id schema refuses anything encoded. */
export const matchRoute = (method: string | undefined, pathname: string): RouteMatch => {
  const [, courseSegment, resource] = COURSE_PATH.exec(pathname) ?? [];
  if (courseSegment === undefined || resource === undefined || !isRouteKey(resource))
    return { status: 'not-found' };
  const { route, method: allowed } = ROUTES[resource];
  return method === allowed
    ? { status: 'matched', route, courseSegment }
    : { status: 'method-not-allowed', allow: allowed };
};
