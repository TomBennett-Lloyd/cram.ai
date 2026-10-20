import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/api-client';
import { ApiContext } from '../api/api-context';
import { fakeApi } from '../api/api-fixture';
import { COURSE_NAME_REFUSED, PENDING } from '../copy';
import { CoursesScreen } from './CoursesScreen';

const renderCourses = async (api: ApiClient) => {
  render(
    <ApiContext value={api}>
      <CoursesScreen />
    </ApiContext>,
  );
  expect(document.querySelector('[aria-busy="true"]')?.textContent).toBe(PENDING.courses);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

const create = (name: string) => {
  fireEvent.change(screen.getByLabelText('New course'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
};

afterEach(() => {
  window.location.hash = '';
});

describe('CoursesScreen', () => {
  it('links each course to its ask screen', async () => {
    await renderCourses(fakeApi(() => ({ status: 200, body: { courses: ['bio', 'chem-2'] } })).api);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['bio', '#/courses/bio'],
      ['chem-2', '#/courses/chem-2'],
    ]);
  });

  it('says how to start when there is no course', async () => {
    await renderCourses(fakeApi(() => ({ status: 200, body: { courses: [] } })).api);
    expect(screen.getByText(/No courses yet/)).toBeDefined();
  });

  it('reports a list it could not read, with a retry that reads it again', async () => {
    let healthy = false;
    const { api } = fakeApi(() =>
      healthy
        ? { status: 200, body: { courses: ['bio'] } }
        : { status: 500, body: { status: 'internal-error' } },
    );
    await renderCourses(api);
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
      'The server could not answer (internal-error).',
    );
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'bio' })).toBeDefined();
  });

  it('takes a new course straight to its decks, under the id the server will file it as', async () => {
    await renderCourses(fakeApi(() => ({ status: 200, body: { courses: [] } })).api);
    create('Cell Biology 2');
    expect(window.location.hash).toBe('#/courses/cell-biology-2/decks');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a name that leaves no id, afresh each time, and clears the refusal once a name works', async () => {
    await renderCourses(fakeApi(() => ({ status: 200, body: { courses: [] } })).api);
    create('!!!');
    const first = screen.getByRole('alert');
    expect(first.textContent).toBe(COURSE_NAME_REFUSED);
    expect(window.location.hash).toBe('');
    create('???');
    expect(screen.getByRole('alert')).not.toBe(first);
    create('Bio');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
