import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { DERIVED_SOURCE, PENDING, SEE_DECKS } from '../copy';
import {
  addTag,
  echoed,
  edits,
  HELD,
  isPut,
  LECTURE,
  renderSlides,
  settle,
  tag,
  tagsOn,
} from './slides-fixture';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SlidesScreen', () => {
  it('shows the pending label with no live region, then the lecture’s slides, each chunk’s lines and tags', async () => {
    const { api, sent } = fakeApi(() => LECTURE);
    renderSlides(api);
    expect(screen.getByText(PENDING.slides).closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
    await settle();
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /courses/bio/slides?lectureId=l1',
    ]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Lecture 1: The Hive');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Slide 1 The queen',
      'Slide 2 The comb',
    ]);
    expect(
      screen.getByText('One queen per colony\nShe lays every egg', { normalizer: (t) => t }),
    ).toBeDefined();
    expect(tagsOn('slide 1')).toEqual(['castes', 'the queen']);
    expect(tagsOn('slide 2, part 2')).toEqual(['wax']);
    expect(screen.queryByRole('list', { name: 'Tags on slide 2, part 1' })).toBeNull();
    expect(screen.getAllByText(DERIVED_SOURCE)).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Remove the suggested tag the queen' }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove the tag castes' })).toBeDefined();
    expect(
      [...document.querySelectorAll('.tag')].map((chip) => chip.getAttribute('data-origin')),
    ).toEqual(['student', 'tagger', 'tagger']);
  });

  it('adds a trimmed tag at once, writes the chunk’s whole list, and shows the list as stored', async () => {
    const { api, sent } = fakeApi((request) => (isPut(request) ? echoed(request) : LECTURE));
    renderSlides(api);
    await settle();
    await addTag('slide 1', '  royal jelly ');
    expect(edits(sent)).toEqual([
      {
        sourceId: 'l1/1',
        chunkNo: 1,
        base: HELD,
        tags: ['castes', 'the queen', 'royal jelly'],
      },
    ]);
    expect(sent.find(isPut)?.contentType).toBe('application/json');
    expect(tagsOn('slide 1')).toEqual(['castes', 'royal jelly', 'the queen']);
    expect(screen.getByRole('textbox', { name: 'Add a tag to slide 1' })).toHaveProperty(
      'value',
      '',
    );
  });

  it('sends nothing for a blank tag or one the chunk already holds', async () => {
    const { api, sent } = fakeApi(() => LECTURE);
    renderSlides(api);
    await settle();
    for (const text of ['', '   ', 'castes', ' the queen ']) await addTag('slide 1', text);
    expect(edits(sent)).toEqual([]);
    expect(tagsOn('slide 1')).toEqual(['castes', 'the queen']);
  });

  it('removes a tag of either origin, handing the focus to the tag that takes its place, then the field', async () => {
    const { api, sent } = fakeApi((request) => (isPut(request) ? echoed(request) : LECTURE));
    renderSlides(api);
    await settle();
    const first = screen.getByRole('button', { name: 'Remove the tag castes' });
    first.focus();
    fireEvent.click(first);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Remove the suggested tag the queen' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove the suggested tag the queen' }));
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Add a tag to slide 1' }),
    );
    expect(edits(sent)).toEqual([
      { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags: ['the queen'] },
      { sourceId: 'l1/1', chunkNo: 1, base: [tag('the queen', 'tagger')], tags: [] },
    ]);
    expect(screen.queryByRole('list', { name: 'Tags on slide 1' })).toBeNull();
  });

  it('hands the focus to the next tag when the first of several is removed', async () => {
    const { api } = fakeApi((request) => (isPut(request) ? echoed(request) : LECTURE));
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'apple');
    const first = screen.getByRole('button', { name: 'Remove the tag apple' });
    first.focus();
    fireEvent.click(first);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Remove the tag castes' }),
    );
  });

  it('hands the focus back to the tag before when the last of several is removed', async () => {
    const { api } = fakeApi((request) => (isPut(request) ? echoed(request) : LECTURE));
    renderSlides(api);
    await settle();
    const last = screen.getByRole('button', { name: 'Remove the suggested tag the queen' });
    last.focus();
    fireEvent.click(last);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Remove the tag castes' }),
    );
  });

  it('leaves the focus where it was when a tag is removed by a press that did not focus its button', async () => {
    const { api } = fakeApi((request) => (isPut(request) ? echoed(request) : LECTURE));
    renderSlides(api);
    await settle();
    const field = screen.getByRole('textbox', { name: 'Add a tag to slide 2, part 1' });
    field.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the tag castes' }));
    await settle();
    expect(document.activeElement).toBe(field);
  });

  it('says the course holds no such lecture, linking its decks', async () => {
    const { api } = fakeApi(() => ({ status: 404, body: { status: 'not-found' } }));
    renderSlides(api);
    await settle();
    expect(screen.getByRole('link', { name: SEE_DECKS }).getAttribute('href')).toBe(
      '#/courses/bio/decks',
    );
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('reports a read that cannot reach the server, with a retry that reads again', async () => {
    let failing = true;
    const { api, sent } = fakeApi(() =>
      failing ? Promise.reject(new TypeError('offline')) : LECTURE,
    );
    renderSlides(api);
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Can’t reach/);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(sent).toHaveLength(2);
    expect(tagsOn('slide 1')).toEqual(['castes', 'the queen']);
  });

  it('heads a lecture with no slides with its id', async () => {
    const { api } = fakeApi(() => ({ status: 200, body: { lectureId: 'l1', slides: [] } }));
    renderSlides(api);
    await settle();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('l1');
  });
});
