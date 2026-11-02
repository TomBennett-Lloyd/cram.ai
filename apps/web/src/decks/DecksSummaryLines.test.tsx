import { StoredLectures } from '@cram/shared';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, HIVE, type Reply, retrievedSlide } from '../api/api-fixture';
import { lecture, remakeStatus, renderDecks, settle, storedStatus } from './decks-fixture';
import { isSummaries, openSummary, statusReads, stored, SUMMARIES } from './summary-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a summary’s lines', () => {
  it('names a slide a line cites twice once, marking both its quotes', async () => {
    const twice: Reply = {
      status: 200,
      body: {
        state: 'read',
        summaries: [
          {
            lectureId: 'l1',
            units: [
              {
                text: 'Workers are female and drones male.',
                citations: [
                  { sourceId: 's1', quote: 'Worker bees are female.' },
                  { sourceId: 's1', quote: 'Drones are male.' },
                ],
                kind: 'lecture-summary',
              },
            ],
          },
        ],
        slides: [HIVE],
      },
    };
    const { api } = fakeApi((request) =>
      isSummaries(request) ? twice : storedStatus(stored(true)),
    );
    renderDecks(api);
    await settle();
    await openSummary();
    const [source, ...others] = screen.getAllByRole('button', { name: /Slide 4/ });
    expect(others).toEqual([]);
    if (source === undefined) throw new Error('no source button');
    fireEvent.click(source);
    expect(
      [...document.querySelectorAll('.slide-dialog mark')].map((mark) => mark.textContent),
    ).toEqual(['Worker bees are female.', 'Drones are male.']);
  });

  it('marks on each slide only the quotes taken from that slide', async () => {
    const drones = retrievedSlide('s3', {
      slideNo: 9,
      body: 'Drones are male. Queens are larger.',
    });
    const across: Reply = {
      status: 200,
      body: {
        state: 'read',
        summaries: [
          {
            lectureId: 'l1',
            units: [
              {
                text: 'Workers are female and drones male.',
                citations: [
                  { sourceId: 's1', quote: 'Worker bees are female.' },
                  { sourceId: 's3', quote: 'Drones are male.' },
                ],
                kind: 'lecture-summary',
              },
            ],
          },
        ],
        slides: [HIVE, drones],
      },
    };
    const { api } = fakeApi((request) =>
      isSummaries(request) ? across : storedStatus(stored(true)),
    );
    renderDecks(api);
    await settle();
    await openSummary();
    fireEvent.click(screen.getByRole('button', { name: /Slide 4/ }));
    expect(
      [...document.querySelectorAll('.slide-dialog mark')].map((mark) => mark.textContent),
    ).toEqual(['Worker bees are female.']);
  });

  it('reads the lines again once the course’s summaries may have changed, and not on closing', async () => {
    const lectures = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 2, [], [], true), lecture('l2', 1, [], [], false)],
      report: { state: 'none' },
    });
    const replies = [
      remakeStatus(lectures, [{ lectureId: 'l2', progress: { state: 'running' } }]),
      remakeStatus(lectures, [{ lectureId: 'l2', progress: { state: 'done', summarised: false } }]),
    ];
    const { api, sent } = fakeApi((request) =>
      isSummaries(request)
        ? SUMMARIES
        : (replies[Math.min(statusReads(sent) - 1, 1)] ?? replies[1] ?? SUMMARIES),
    );
    renderDecks(api);
    await settle();
    const details = await openSummary();
    expect(sent.filter(isSummaries)).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    await act(async () => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent.filter(isSummaries)).toHaveLength(1);
    await openSummary();
    expect(sent.filter(isSummaries)).toHaveLength(2);
  });
});
