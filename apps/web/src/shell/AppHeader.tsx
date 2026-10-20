import type { Route } from './route';
import { hrefOf } from './route';

const CourseNav = ({
  route,
}: {
  readonly route: Extract<Route, { readonly courseId: unknown }>;
}) => {
  const { courseId } = route;
  const tabs = [
    { screen: 'ask', label: 'Ask' },
    { screen: 'decks', label: 'Decks' },
  ] as const;
  return (
    <nav className="course-nav" aria-label="Course">
      <span className="course-name">{courseId}</span>
      {tabs.map(({ screen, label }) => (
        <a
          key={screen}
          href={hrefOf({ screen, courseId })}
          aria-current={route.screen === screen ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
};

/** The product name, home to the course list, and inside a course its two screens. */
export const AppHeader = ({ route }: { readonly route: Route }) => (
  <header className="app-header">
    <a className="app-name" href={hrefOf({ screen: 'courses' })}>
      cram.ai
    </a>
    {(route.screen === 'ask' || route.screen === 'decks') && <CourseNav route={route} />}
  </header>
);
