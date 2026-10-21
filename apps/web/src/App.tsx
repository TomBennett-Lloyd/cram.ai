import { AskScreen } from './ask/AskScreen';
import { CoursesScreen } from './courses/CoursesScreen';
import { DecksScreen } from './decks/DecksScreen';
import { AppHeader } from './shell/AppHeader';
import { Empty } from './shell/async-states';
import type { Route } from './shell/route';
import { useRoute } from './shell/use-route';

const Screen = ({ route }: { readonly route: Route }) => {
  switch (route.screen) {
    case 'courses':
      return <CoursesScreen />;
    case 'ask':
      return <AskScreen key={route.courseId} courseId={route.courseId} />;
    case 'decks':
      return <DecksScreen key={route.courseId} courseId={route.courseId} />;
    case 'not-found':
      return (
        <main className="screen">
          <Empty>
            There is nothing at this address. <a href="#/">See your courses</a>.
          </Empty>
        </main>
      );
  }
};

export const App = () => {
  const route = useRoute();
  return (
    <>
      <AppHeader route={route} />
      <Screen route={route} />
    </>
  );
};
