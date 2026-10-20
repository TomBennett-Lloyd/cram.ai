import type { CourseId } from '@cram/shared';
import { type SubmitEvent, useState } from 'react';
import { useApi } from '../api/api-context';
import { COURSE_NAME_REFUSED, failureMessage, PENDING } from '../copy';
import { Empty, Failed, Pending } from '../shell/async-states';
import { hrefOf } from '../shell/route';
import { courseIdFromName } from './course-name';
import { useCourses } from './use-courses';

const CourseLinks = ({ courses }: { readonly courses: readonly CourseId[] }) =>
  courses.length === 0 ? (
    <Empty>No courses yet. Name one below, then add its decks.</Empty>
  ) : (
    <ul className="course-list">
      {courses.map((courseId) => (
        <li key={courseId}>
          <a href={hrefOf({ screen: 'ask', courseId })}>{courseId}</a>
        </li>
      ))}
    </ul>
  );

/** A course exists once its first deck is uploaded, so naming one goes straight to its decks. */
const NewCourse = () => {
  /** Counts refused submissions, so a repeat refusal remounts its alert and is announced again. */
  const [refusals, setRefusals] = useState(0);
  const [refused, setRefused] = useState(false);
  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const courseId = typeof name === 'string' ? courseIdFromName(name) : undefined;
    setRefused(courseId === undefined);
    if (courseId === undefined) setRefusals((count) => count + 1);
    else window.location.hash = hrefOf({ screen: 'decks', courseId });
  };
  return (
    <form className="new-course" onSubmit={onSubmit}>
      <label htmlFor="new-course-name">New course</label>
      <div className="field-row">
        <input id="new-course-name" name="name" autoComplete="off" required />
        <button type="submit">Create</button>
      </div>
      {refused && <Failed key={refusals} messages={[COURSE_NAME_REFUSED]} />}
    </form>
  );
};

export const CoursesScreen = () => {
  const [revision, setRevision] = useState(0);
  const state = useCourses(useApi(), revision);
  return (
    <main className="screen">
      <h1>Courses</h1>
      {state.status === 'pending' ? (
        <Pending label={PENDING.courses} />
      ) : state.status === 'ok' ? (
        <CourseLinks courses={state.value.courses} />
      ) : (
        <Failed
          messages={[failureMessage(state)]}
          onRetry={() => {
            setRevision((value) => value + 1);
          }}
        />
      )}
      <NewCourse />
    </main>
  );
};
