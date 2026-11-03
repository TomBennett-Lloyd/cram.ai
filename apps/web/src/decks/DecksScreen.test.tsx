import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { PENDING } from '../copy';
import { reads, renderDecks, settle, status, upload } from './decks-fixture';
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
      status(
        upload('l1.pdf', {
          state: 'indexed',
          slideCount: 12,
          imageOnly: [3, 9],
          unembedded: [],
          summarised: true,
        }),
      ),
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
      screen.getByText(
        '12 slides indexed. Slides 3, 9 have too little text to read as slides, so only titles or speaker notes on them can be cited.',
      ),
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
        upload('b.pdf', {
          state: 'indexed',
          slideCount: 88,
          imageOnly: [],
          unembedded: [87],
          summarised: true,
        }),
        upload('c.pdf', { state: 'course-unavailable', problem: 'embedder-mismatch' }),
        upload('d.pdf', { state: 'failed' }),
        upload('e.pdf', {
          state: 'indexed',
          slideCount: 1,
          imageOnly: [1],
          unembedded: [],
          summarised: true,
        }),
        upload('f.pdf', {
          state: 'indexed',
          slideCount: 6,
          imageOnly: [3],
          unembedded: [2, 5],
          summarised: true,
        }),
        upload('g.pdf', { state: 'unreadable', reason: 'not-a-deck', detail: 'no slides' }),
      ),
    );
    renderDecks(api);
    await settle();
    expect(
      [...document.querySelectorAll('.upload-progress')].map((node) => node.textContent),
    ).toEqual([
      'This deck couldn’t be read (encrypted).',
      '88 slides indexed. Slide 87 holds more text than the search model reads at once, so it’s found by its words only.',
      'This course’s file was indexed by a different embedding model, so the deck was not indexed.',
      'Something went wrong reading this deck. Upload it again.',
      '1 slide indexed. Slide 1 has too little text to read as a slide, so only a title or speaker notes on it can be cited.',
      '6 slides indexed. Slide 3 has too little text to read as a slide, so only a title or speaker notes on it can be cited. Slides 2, 5 hold more text than the search model reads at once, so they’re found by their words only.',
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

  it('keeps the batch’s refusals in the alert across a retry of a failed status read', async () => {
    let healthy = true;
    const { api } = fakeApi(({ path }) => {
      if (path.startsWith('/courses/bio/decks'))
        return { status: 415, body: { status: 'unsupported-media-type' } };
      return healthy ? status() : { status: 200, body: { nope: true } };
    });
    renderDecks(api);
    await settle();
    healthy = false;
    fireEvent.change(screen.getByLabelText('Add decks'), {
      target: { files: [new File(['x'], 'a.key')] },
    });
    await settle();
    const lines = () =>
      [...screen.getByRole('alert').querySelectorAll('p')].map((line) => line.textContent);
    expect(lines()).toEqual([
      'a.key: Only PDF and PowerPoint (.pptx) decks can be read.',
      'The server sent a reply this app doesn’t understand.',
    ]);
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(lines()).toEqual(['a.key: Only PDF and PowerPoint (.pptx) decks can be read.']);
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
});
