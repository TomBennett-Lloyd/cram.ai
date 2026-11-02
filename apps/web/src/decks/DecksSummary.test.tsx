import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type Reply } from '../api/api-fixture';
import { MAKE_SUMMARY, NO_SUMMARY, PENDING, SUMMARY, SUMMARY_FAILED } from '../copy';
import { reads, remakeStatus, renderDecks, settle, storedStatus, upload } from './decks-fixture';
import {
  isRemake,
  isSummaries,
  openSummary,
  statusReads,
  stored,
  SUMMARIES,
} from './summary-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a lecture’s summary on the decks screen', () => {
  it('stays folded and unread until opened, then shows each line with the slides it cites', async () => {
    const { api, sent } = fakeApi((request) =>
      isSummaries(request) ? SUMMARIES : storedStatus(stored(true)),
    );
    renderDecks(api);
    await settle();
    const details = document.querySelector('details.lecture-summary');
    expect(details?.querySelector('summary')?.textContent).toBe(SUMMARY);
    expect(details?.hasAttribute('open')).toBe(false);
    expect(sent.filter(isSummaries)).toEqual([]);
    await openSummary();
    expect(sent.filter(isSummaries)).toHaveLength(1);
    const line = screen.getByText('Workers are female.');
    expect(line).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Slide 4/ }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.querySelector('.slide-dialog mark')?.textContent).toBe(
      'Worker bees are female.',
    );
  });

  it('reads the lines once however often it is opened, and offers a retry when the read cannot reach the server', async () => {
    let failing = true;
    const { api, sent } = fakeApi((request) => {
      if (!isSummaries(request)) return storedStatus(stored(true));
      return failing ? Promise.reject(new TypeError('offline')) : SUMMARIES;
    });
    renderDecks(api);
    await settle();
    const details = await openSummary();
    const alert = within(details).getByRole('alert');
    failing = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Workers are female.')).toBeDefined();
    await openSummary();
    expect(sent.filter(isSummaries)).toHaveLength(2);
  });

  it('offers to make a missing summary, shows the re-make under way, and re-reads until it is done', async () => {
    const replies = [
      storedStatus(stored(false)),
      remakeStatus(stored(false), [{ lectureId: 'l1', progress: { state: 'queued' } }]),
      remakeStatus(stored(false), [{ lectureId: 'l1', progress: { state: 'running' } }]),
      remakeStatus(stored(false), [
        { lectureId: 'l1', progress: { state: 'done', summarised: false } },
      ]),
    ];
    const { api, sent } = fakeApi((request) =>
      isRemake(request)
        ? { status: 202, body: { lectureId: 'l1', progress: { state: 'queued' } } }
        : (replies[Math.min(statusReads(sent) - 1, 3)] ?? storedStatus(stored(false))),
    );
    renderDecks(api);
    await settle();
    const state = () => document.querySelector('.lecture-summary-state');
    expect(state()?.textContent).toBe(`${NO_SUMMARY} ${MAKE_SUMMARY}`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: MAKE_SUMMARY }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent.filter(isRemake).map(({ body }) => JSON.parse(body) as unknown)).toEqual([
      { lectureId: 'l1' },
    ]);
    expect(state()?.getAttribute('aria-busy')).toBe('true');
    expect(state()?.textContent).toBe(`${PENDING.remake} ${MAKE_SUMMARY}`);
    expect(screen.getByRole('button', { name: MAKE_SUMMARY }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(state()?.textContent).toBe(`${SUMMARY_FAILED} ${MAKE_SUMMARY}`);
    expect(state()?.getAttribute('aria-busy')).toBe('false');
    const settledReads = statusReads(sent);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    expect(statusReads(sent)).toBe(settledReads);
  });

  it('says an upload’s summary could not be made, and shows the upload summarising meanwhile', async () => {
    const replies = [
      storedStatus(stored(false), upload('l1', { state: 'summarising' })),
      storedStatus(
        stored(false),
        upload('l1', {
          state: 'indexed',
          slideCount: 2,
          imageOnly: [],
          unembedded: [],
          summarised: false,
        }),
      ),
    ];
    const { api, sent } = fakeApi(
      () => replies[Math.min(reads(sent) - 1, 1)] ?? storedStatus(stored(false)),
    );
    renderDecks(api);
    await settle();
    expect(screen.getByText('Summarising the lecture…')).toBeDefined();
    expect(document.querySelector('.lecture-summary-state')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(document.querySelector('.lecture-summary-state')?.textContent).toBe(
      `${SUMMARY_FAILED} ${MAKE_SUMMARY}`,
    );
  });

  it('reports a re-make the server refused', async () => {
    const { api } = fakeApi((request) =>
      isRemake(request)
        ? { status: 404, body: { status: 'not-found' } }
        : storedStatus(stored(false)),
    );
    renderDecks(api);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: MAKE_SUMMARY }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('alert').textContent).toBe('The server could not answer (not-found).');
  });

  it('shows a re-make under way from the press, before the server has answered it', async () => {
    const { api } = fakeApi((request) =>
      isRemake(request) ? new Promise<Reply>(() => undefined) : storedStatus(stored(false)),
    );
    renderDecks(api);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: MAKE_SUMMARY }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelector('.lecture-summary-state')?.getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('offers a retry when the server’s reply is not one it understands, and reads again on it', async () => {
    let malformed = true;
    const { api, sent } = fakeApi((request) => {
      if (!isSummaries(request)) return storedStatus(stored(true));
      return malformed ? { status: 200, body: { state: 'read' } } : SUMMARIES;
    });
    renderDecks(api);
    await settle();
    const details = await openSummary();
    malformed = false;
    await act(async () => {
      fireEvent.click(within(within(details).getByRole('alert')).getByRole('button'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent.filter(isSummaries)).toHaveLength(2);
    expect(screen.getByText('Workers are female.')).toBeDefined();
  });
});
