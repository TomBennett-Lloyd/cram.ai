import { CourseRepair, StoredLectures } from '@cram/shared';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { discardedMessage, PENDING } from '../copy';
import { lecture, reads, renderDecks, repairStatus, rows, settle, status } from './decks-fixture';
import { POLL_INTERVAL_MS } from './use-ingest-status';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the course file’s start-up repair', () => {
  const UNAVAILABLE = StoredLectures.parse({
    state: 'course-unavailable',
    problem: 'older-schema',
  });
  const STORED = StoredLectures.parse({ state: 'read', lectures: [lecture('l1', 2, [])] });
  const repair = (value: unknown) => CourseRepair.parse(value);
  const busy = () =>
    [...document.querySelectorAll('[aria-busy="true"]')].map((node) => node.textContent);

  it('says the file is being updated while its repair is queued or running, and re-reads until it is done', async () => {
    const replies = [
      repairStatus(UNAVAILABLE, repair({ state: 'queued' })),
      repairStatus(UNAVAILABLE, repair({ state: 'running' })),
      repairStatus(STORED, repair({ state: 'done', discarded: [] })),
    ];
    const { api, sent } = fakeApi(() => replies[Math.min(reads(sent) - 1, 2)] ?? status());
    renderDecks(api);
    await settle();
    expect(busy()).toEqual([PENDING.repair]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(busy()).toEqual([PENDING.repair]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(busy()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(rows()).toEqual([['l1', '2 slides indexed.']]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    expect(reads(sent)).toBe(3);
  });

  it('says nothing of a repair still running on a file that already opens', async () => {
    const { api } = fakeApi(() => repairStatus(STORED, repair({ state: 'running' })));
    renderDecks(api);
    await settle();
    expect(busy()).toEqual([]);
    expect(rows()).toEqual([['l1', '2 slides indexed.']]);
  });

  it('says the file could not be updated when its repair failed', async () => {
    const { api } = fakeApi(() => repairStatus(UNAVAILABLE, repair({ state: 'failed' })));
    renderDecks(api);
    await settle();
    expect(busy()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe(
      'This course’s file can’t be opened (older-schema) and couldn’t be updated, so its stored decks can’t be listed.',
    );
  });

  it('tells the student what a rebuild lost, beside the lectures it kept', async () => {
    const discarded = [{ table: 'topics', rows: 12 }];
    const { api } = fakeApi(() => repairStatus(STORED, repair({ state: 'done', discarded })));
    renderDecks(api);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(discardedMessage(discarded));
    expect(discardedMessage(discarded)).toMatch(/^This course was rebuilt from its stored decks/);
    expect(rows()).toEqual([['l1', '2 slides indexed.']]);
  });

  it('still says what a rebuild lost when the file cannot be opened since', async () => {
    const discarded = [{ table: 'topics', rows: 12 }];
    const { api } = fakeApi(() => repairStatus(UNAVAILABLE, repair({ state: 'done', discarded })));
    renderDecks(api);
    await settle();
    expect([...screen.getByRole('alert').querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      discardedMessage(discarded),
      'This course’s file can’t be opened (older-schema), so its stored decks can’t be listed.',
    ]);
  });
});
