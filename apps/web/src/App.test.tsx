import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiContext } from './api/api-context';
import { fakeApi } from './api/api-fixture';
import { App } from './App';

const renderAt = (hash: string) => {
  window.location.hash = hash;
  const { api } = fakeApi(() => ({ status: 200, body: { courses: [] } }));
  return render(
    <ApiContext value={api}>
      <App />
    </ApiContext>,
  );
};

afterEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('opens on the course list, with no live region carrying text', () => {
    renderAt('');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Courses');
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows a course’s two screens in its nav, the current one marked', () => {
    renderAt('#/courses/bio/decks');
    const nav = screen.getByRole('navigation', { name: 'Course' });
    expect(nav.textContent).toBe('bioAskDecks');
    expect(screen.getByRole('link', { name: 'Decks' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Ask' }).getAttribute('aria-current')).toBeNull();
  });

  it('follows the hash as it changes', () => {
    renderAt('#/courses/bio');
    expect(screen.getByRole('textbox', { name: 'Question' })).toBeDefined();
    act(() => {
      window.location.hash = '#/nowhere';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText(/nothing at this address/)).toBeDefined();
  });
});
