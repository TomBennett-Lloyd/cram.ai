import { StoredLectures } from '@cram/shared';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { lecture, reads, renderDecks, rows, settle, storedStatus, upload } from './decks-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the course file’s stored lectures', () => {
  it('lists the course file’s lectures after a restart, with no uploads since', async () => {
    const stored = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 1, [1])],
      report: { state: 'none' },
    });
    const { api, sent } = fakeApi(() => storedStatus(stored));
    renderDecks(api);
    await settle();
    expect(rows()).toEqual([
      [
        'l1',
        '1 slide indexed. Slide 1 has too little text to read as a slide, so only a title or speaker notes on it can be cited.',
      ],
    ]);
    expect(screen.queryByText(/No decks yet/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    expect(reads(sent)).toBe(1);
  });

  it('lists the lectures the course file holds, leaving one with an indexed upload this session to that upload', async () => {
    const stored = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 12, [3, 9]), lecture('l2', 1, []), lecture('l3', 4, [], [4])],
      report: { state: 'none' },
    });
    const { api } = fakeApi(() =>
      storedStatus(
        stored,
        upload('l2', {
          state: 'indexed',
          slideCount: 2,
          imageOnly: [],
          unembedded: [],
          summarised: true,
        }),
        upload('l3', { state: 'unreadable', reason: 'encrypted', detail: '' }),
      ),
    );
    renderDecks(api);
    await settle();
    expect(rows()).toEqual([
      [
        'l1',
        '12 slides indexed. Slides 3, 9 have too little text to read as slides, so only titles or speaker notes on them can be cited.',
      ],
      [
        'l3',
        '4 slides indexed. Slide 4 holds more text than the search model reads at once, so it’s found by its words only.',
      ],
      ['l2', '2 slides indexed.'],
      ['l3', 'This deck couldn’t be read (encrypted).'],
    ]);
  });

  it('links each stored lecture and each indexed upload to its slide browser, and no other upload', async () => {
    const stored = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('week 2/lab', 1, [])],
      report: { state: 'none' },
    });
    const indexed = { state: 'indexed', slideCount: 2, imageOnly: [], unembedded: [] };
    const { api } = fakeApi(() =>
      storedStatus(
        stored,
        upload('l2', { ...indexed, summarised: false }),
        upload('l3', { state: 'unreadable', reason: 'encrypted', detail: '' }),
      ),
    );
    renderDecks(api);
    await settle();
    expect(
      screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['week 2/lab', '#/courses/bio/decks/week%202%2Flab'],
      ['l2', '#/courses/bio/decks/l2'],
    ]);
  });

  it('says why stored lectures are missing when the course file cannot be opened', async () => {
    const unavailable = StoredLectures.parse({
      state: 'course-unavailable',
      problem: 'embedder-mismatch',
    });
    const { api } = fakeApi(() => storedStatus(unavailable));
    renderDecks(api);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(
      'This course’s file was indexed by a different embedding model, so its stored decks can’t be listed.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText(/No decks yet/)).toBeNull();
    expect(rows()).toEqual([]);
  });
});
