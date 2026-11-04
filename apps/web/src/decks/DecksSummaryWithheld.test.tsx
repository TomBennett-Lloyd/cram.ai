import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { StoredLectures } from '@cram/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMB, fakeApi, HIVE, type Reply } from '../api/api-fixture';
import { MAKE_SUMMARY, SUMMARY_ALL_WITHHELD, SUMMARY_FAILED, SUMMARY_REPLACED } from '../copy';
import { lecture, remakeStatus, renderDecks, settle, storedStatus, upload } from './decks-fixture';
import { isRemake, isSummaries, openSummary, statusReads } from './summary-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const KEPT = 'Workers are female.';
const UNSUPPORTED = 'Workers rule the hive.';
const PARTIAL = 'Drones are male and sting.';
const DANGLING = 'Cells are round.';

const storedWith = (summarised: boolean, withheld: number) =>
  storedStatus(
    StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 2, [], [], summarised, withheld)],
      report: { state: 'none' },
    }),
  );

const digests = (units: readonly object[], withheld: readonly object[]): Reply => ({
  status: 200,
  body: { state: 'read', summaries: [{ lectureId: 'l1', units, withheld }], slides: [HIVE, COMB] },
});

const unit = (text: string, citations: readonly object[]) => ({
  text,
  citations,
  kind: 'lecture-summary',
});

const WITHHELD = [
  {
    reason: 'unsupported',
    unit: unit(UNSUPPORTED, [{ sourceId: 's1', quote: 'Worker bees are female.' }]),
  },
  {
    reason: 'partial',
    policy: 'drop',
    unit: unit(PARTIAL, [{ sourceId: 's1', quote: 'Drones are male.' }]),
  },
  { reason: 'dangling-citation', unit: unit(DANGLING, []) },
];

const panel = () => {
  const found = document.querySelector('details.withheld');
  if (!(found instanceof HTMLDetailsElement)) throw new Error('no withheld panel');
  return found;
};

const openWithheld = async () => {
  const details = panel();
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await vi.advanceTimersByTimeAsync(0);
  });
  return details;
};

describe('the units withheld from a lecture’s summary', () => {
  it('are counted in a folded panel beside the summary, read when opened, each with why and its slides, and never among its lines', async () => {
    const { api, sent } = fakeApi((request) =>
      isSummaries(request)
        ? digests([unit(KEPT, [{ sourceId: 's1', quote: 'Worker bees are female.' }])], WITHHELD)
        : storedWith(true, 3),
    );
    renderDecks(api);
    await settle();
    expect(panel().querySelector('summary')?.textContent).toBe('Withheld (3)');
    expect(panel().open).toBe(false);
    expect(sent.filter(isSummaries)).toEqual([]);
    const details = await openWithheld();
    expect(sent.filter(isSummaries)).toHaveLength(1);
    const entries = [...details.querySelectorAll(':scope > ul > li')].map((entry) => [
      entry.querySelector('.withheld-text')?.textContent,
      entry.querySelector('.withheld-reason')?.textContent,
    ]);
    expect(entries).toEqual([
      [UNSUPPORTED, 'The slides it cites don’t say it.'],
      [PARTIAL, 'The slides it cites say only part of it, so it was left out.'],
      [
        DANGLING,
        'It cites no slide line, or a line its slide doesn’t have, so it couldn’t be checked.',
      ],
    ]);
    await openSummary();
    const lines = document.querySelector('.summary-lines');
    expect(lines?.textContent).toContain(KEPT);
    for (const text of [UNSUPPORTED, PARTIAL, DANGLING])
      expect(lines?.textContent).not.toContain(text);
    expect(sent.filter(isSummaries)).toHaveLength(1);
    expect(
      [...details.querySelectorAll(':scope > ul > li')].map(
        (entry) => entry.querySelectorAll('.slide-card').length,
      ),
    ).toEqual([1, 1, 0]);
    expect(
      details.querySelectorAll(':scope > ul > li')[2]?.querySelector('ul.citations'),
    ).toBeNull();
    fireEvent.click(within(details).getAllByRole('button', { name: /Slide 4/ })[1] ?? details);
    expect(document.querySelector('.slide-dialog mark')?.textContent).toBe('Drones are male.');
  });

  it('are shown beside the re-make action for a lecture that kept none, which says so', async () => {
    const { api } = fakeApi((request) =>
      isSummaries(request) ? digests([], WITHHELD.slice(0, 1)) : storedWith(false, 1),
    );
    renderDecks(api);
    await settle();
    expect(document.querySelector('details.lecture-summary')).toBeNull();
    const state = document.querySelector('.lecture-summary-state');
    expect(state?.textContent).toBe(`${SUMMARY_ALL_WITHHELD} ${MAKE_SUMMARY}`);
    expect(panel().querySelector('summary')?.textContent).toBe('Withheld (1)');
    await openWithheld();
    expect(within(panel()).getByText(UNSUPPORTED)).toBeDefined();
  });

  it('announce a pressed re-make that kept nothing as one that could not be made, whatever the stored row says', async () => {
    const lectures = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 2, [], [], false, 1)],
      report: { state: 'none' },
    });
    const replies = [
      storedStatus(lectures),
      remakeStatus(lectures, [{ lectureId: 'l1', progress: { state: 'running' } }]),
      remakeStatus(lectures, [{ lectureId: 'l1', progress: { state: 'done', summarised: false } }]),
    ];
    const { api, sent } = fakeApi((request) =>
      isRemake(request)
        ? { status: 202, body: { lectureId: 'l1', progress: { state: 'queued' } } }
        : (replies[Math.min(statusReads(sent) - 1, 2)] ?? storedStatus(lectures)),
    );
    renderDecks(api);
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: MAKE_SUMMARY }));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(screen.getByRole('alert').textContent).toBe(SUMMARY_FAILED);
  });

  it('say an upload this session that kept no line kept none, not that it could not be made', async () => {
    const lectures = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 2, [], [], false, 1)],
      report: { state: 'none' },
    });
    const indexed = { state: 'indexed', slideCount: 2, imageOnly: [], unembedded: [] };
    const { api } = fakeApi(() =>
      storedStatus(lectures, upload('l1', { ...indexed, summarised: false })),
    );
    renderDecks(api);
    await settle();
    expect(document.querySelector('.lecture-summary-state')?.textContent).toBe(
      `${SUMMARY_ALL_WITHHELD} ${MAKE_SUMMARY}`,
    );
  });

  it('show no panel for a lecture that withheld none', async () => {
    const { api } = fakeApi(() => storedWith(true, 0));
    renderDecks(api);
    await settle();
    expect(document.querySelector('details.withheld')).toBeNull();
  });

  it('say the summary has changed when the digest read holds none of the counted units, and so do its lines when it holds none of them', async () => {
    const { api } = fakeApi((request) =>
      isSummaries(request) ? digests([], WITHHELD.slice(0, 1)) : storedWith(true, 2),
    );
    renderDecks(api);
    await settle();
    await openWithheld();
    expect(within(panel()).queryByText(SUMMARY_REPLACED)).toBeNull();
    const details = await openSummary();
    expect(within(details).getByText(SUMMARY_REPLACED)).toBeDefined();
    const { api: emptied } = fakeApi((request) =>
      isSummaries(request) ? digests([unit(KEPT, [])], []) : storedWith(true, 2),
    );
    cleanup();
    renderDecks(emptied);
    await settle();
    await openWithheld();
    expect(within(panel()).getByText(SUMMARY_REPLACED)).toBeDefined();
  });

  it('are read again at the next open once the stored summaries may have changed, not on closing', async () => {
    const lectures = StoredLectures.parse({
      state: 'read',
      lectures: [lecture('l1', 2, [], [], false, 1)],
      report: { state: 'none' },
    });
    const replies = [
      remakeStatus(lectures, [{ lectureId: 'l1', progress: { state: 'running' } }]),
      remakeStatus(lectures, [{ lectureId: 'l1', progress: { state: 'done', summarised: false } }]),
    ];
    const { api, sent } = fakeApi((request) =>
      isSummaries(request)
        ? digests([], WITHHELD.slice(0, 1))
        : (replies[Math.min(statusReads(sent) - 1, 1)] ?? replies[1] ?? digests([], [])),
    );
    renderDecks(api);
    await settle();
    const details = await openWithheld();
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
    await openWithheld();
    expect(sent.filter(isSummaries)).toHaveLength(2);
  });
});
