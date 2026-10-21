import { StoredLectures } from '@cram/shared';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { PENDING } from '../copy';
import {
  lecture,
  reads,
  renderDecks,
  rows,
  settle,
  status,
  storedStatus,
  upload,
} from './decks-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DecksScreen', () => {
  it('shows the pending label, then an empty course as an empty list', async () => {
    const { api } = fakeApi(() => ({ status: 404, body: { status: 'no-such-course' } }));
    renderDecks(api);
    expect(document.querySelector('[aria-busy="true"]')?.textContent).toBe(PENDING.decks);
    await settle();
    expect(screen.getByText(/No decks yet/)).toBeDefined();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('re-reads while an upload is in flight, and stops once every one has settled', async () => {
    const replies = [
      status(upload('l1.pdf', { state: 'queued' })),
      status(upload('l1.pdf', { state: 'ingesting' })),
      status(upload('l1.pdf', { state: 'indexed', slideCount: 12, imageOnly: [3, 9] })),
    ];
    const { api, sent } = fakeApi(() => replies[Math.min(reads(sent) - 1, 2)] ?? status());
    renderDecks(api);
    await settle();
    expect(screen.getByText('Waiting to be read…')).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(screen.getByText('Reading slides…')).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(
      screen.getByText('12 slides indexed. Slides 3, 9 have no text, so they can’t be cited yet.'),
    ).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    expect(reads(sent)).toBe(3);
  });

  it('names every state ingest can end in', async () => {
    const { api } = fakeApi(() =>
      status(
        upload('a.pdf', { state: 'unreadable', reason: 'encrypted', detail: '' }),
        upload('b.pdf', { state: 'over-length', slides: [2], maxInputTokens: 512 }),
        upload('c.pdf', { state: 'course-unavailable', problem: 'embedder-mismatch' }),
        upload('d.pdf', { state: 'failed' }),
        upload('e.pdf', { state: 'indexed', slideCount: 1, imageOnly: [1] }),
        upload('f.pdf', { state: 'over-length', slides: [2, 5], maxInputTokens: 512 }),
        upload('g.pdf', { state: 'unreadable', reason: 'not-a-deck', detail: 'no slides' }),
      ),
    );
    renderDecks(api);
    await settle();
    expect(
      [...document.querySelectorAll('.upload-progress')].map((node) => node.textContent),
    ).toEqual([
      'This deck couldn’t be read (encrypted).',
      'Slide 2 holds more text than the model reads at once (512 tokens), so nothing from this deck was indexed.',
      'This course’s file can’t be opened (embedder-mismatch), so the deck was not indexed.',
      'Something went wrong reading this deck. Upload it again.',
      '1 slide indexed. Slide 1 has no text, so it can’t be cited yet.',
      'Slides 2, 5 hold more text than the model reads at once (512 tokens), so nothing from this deck was indexed.',
      'This deck couldn’t be read (not-a-deck: no slides).',
    ]);
  });

  it('uploads each picked file as its own lecture, reports a refusal, then re-reads', async () => {
    const { api, sent } = fakeApi(({ path }) =>
      path.startsWith('/courses/bio/decks')
        ? path.includes('notes')
          ? { status: 415, body: { status: 'unsupported-media-type' } }
          : { status: 202, body: upload('l1.pdf', { state: 'queued' }) }
        : status(),
    );
    renderDecks(api);
    await settle();
    const files = [new File(['%PDF'], 'l1.pdf'), new File(['x'], 'notes.txt')];
    fireEvent.change(screen.getByLabelText('Add decks'), { target: { files } });
    await settle();
    const posts = sent.filter(({ method }) => method === 'POST');
    expect(posts.map(({ path }) => path)).toEqual([
      '/courses/bio/decks?lectureId=l1&fileName=l1.pdf',
      '/courses/bio/decks?lectureId=notes&fileName=notes.txt',
    ]);
    expect(posts[0]?.contentType).toBe('application/pdf');
    expect(screen.getByRole('alert').textContent).toBe(
      'notes.txt: Only PDF and PowerPoint (.pptx) decks can be read.',
    );
    expect(reads(sent)).toBe(2);
  });

  it('reports a failed status read with a retry that resumes reading', async () => {
    let healthy = false;
    const { api, sent } = fakeApi(() =>
      healthy
        ? status(upload('l1.pdf', { state: 'ingesting' }))
        : { status: 200, body: { nope: true } },
    );
    renderDecks(api);
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(
      'The server sent a reply this app doesn’t understand.',
    );
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Reading slides…')).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(reads(sent)).toBe(3);
  });

  it('reports a batch’s refusals in one alert, and announces a repeat refusal afresh', async () => {
    const { api } = fakeApi(({ path }) =>
      path.startsWith('/courses/bio/decks')
        ? { status: 415, body: { status: 'unsupported-media-type' } }
        : status(),
    );
    renderDecks(api);
    await settle();
    const pick = async (...names: string[]) => {
      fireEvent.change(screen.getByLabelText('Add decks'), {
        target: { files: names.map((name) => new File(['x'], name)) },
      });
      await settle();
      return screen.getByRole('alert');
    };
    const first = await pick('a.key', 'b.key');
    expect([...first.querySelectorAll('p')].map((line) => line.textContent)).toEqual([
      'a.key: Only PDF and PowerPoint (.pptx) decks can be read.',
      'b.key: Only PDF and PowerPoint (.pptx) decks can be read.',
    ]);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const second = await pick('a.key', 'b.key');
    expect(second).not.toBe(first);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('lists the course file’s lectures after a restart, with no uploads since', async () => {
    const stored = StoredLectures.parse({ state: 'read', lectures: [lecture('l1', 1, [1])] });
    const { api, sent } = fakeApi(() => storedStatus(stored));
    renderDecks(api);
    await settle();
    expect(rows()).toEqual([
      ['l1', '1 slide indexed. Slide 1 has no text, so it can’t be cited yet.'],
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
      lectures: [lecture('l1', 12, [3, 9]), lecture('l2', 1, []), lecture('l3', 4, [])],
    });
    const { api } = fakeApi(() =>
      storedStatus(
        stored,
        upload('l2', { state: 'indexed', slideCount: 2, imageOnly: [] }),
        upload('l3', { state: 'unreadable', reason: 'encrypted', detail: '' }),
      ),
    );
    renderDecks(api);
    await settle();
    expect(rows()).toEqual([
      ['l1', '12 slides indexed. Slides 3, 9 have no text, so they can’t be cited yet.'],
      ['l3', '4 slides indexed.'],
      ['l2', '2 slides indexed.'],
      ['l3', 'This deck couldn’t be read (encrypted).'],
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
      'This course’s file can’t be opened (embedder-mismatch), so its stored decks can’t be listed.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText(/No decks yet/)).toBeNull();
    expect(rows()).toEqual([]);
  });
});
