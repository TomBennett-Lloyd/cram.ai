import { CourseRepair, StoredLectures } from '@cram/shared';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import { discardedMessage, DISMISS, PENDING } from '../copy';
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
  const storedWith = (discarded: unknown[]) =>
    StoredLectures.parse({ state: 'read', lectures: [lecture('l1', 2, [])], discarded });
  const STORED = storedWith([]);
  const repair = (value: unknown) => CourseRepair.parse(value);
  const busy = () =>
    [...document.querySelectorAll('[aria-busy="true"]')].map((node) => node.textContent);

  it('says the file is being updated while its repair is queued or running, and re-reads until it is done', async () => {
    const replies = [
      repairStatus(UNAVAILABLE, repair({ state: 'queued' })),
      repairStatus(UNAVAILABLE, repair({ state: 'running' })),
      repairStatus(STORED, repair({ state: 'done' })),
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

  it('tells the student what a rebuild lost, beside the lectures it kept, until they dismiss it', async () => {
    const discarded = [{ table: 'topics', rows: 12 }];
    const { api, sent } = fakeApi(({ method }) =>
      method === 'DELETE'
        ? { status: 200, body: { status: 'dismissed' } }
        : repairStatus(storedWith(discarded), repair({ state: 'done' })),
    );
    renderDecks(api);
    await settle();
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
      discardedMessage(discarded),
    );
    expect(discardedMessage(discarded)).toMatch(/^This course was rebuilt from its stored decks/);
    expect(rows()).toEqual([['l1', '2 slides indexed.']]);
    fireEvent.click(screen.getByRole('button', { name: DISMISS }));
    await settle();
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/courses/bio/rebuild-report' });
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(document.activeElement).toBe(screen.getByLabelText('Add decks'));
    expect(reads(sent)).toBe(1);
  });

  it('keeps the notice, and says why, when the dismissal is refused', async () => {
    const discarded = [{ table: 'topics', rows: 12 }];
    const { api } = fakeApi(({ method }) =>
      method === 'DELETE'
        ? { status: 409, body: { status: 'course-unavailable', problem: 'newer-schema' } }
        : repairStatus(storedWith(discarded), repair({ state: 'done' })),
    );
    renderDecks(api);
    await settle();
    const button = screen.getByRole('button', { name: DISMISS });
    button.focus();
    fireEvent.click(button);
    await settle();
    expect([...screen.getByRole('alert').querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'This course’s file can’t be opened (newer-schema).',
      discardedMessage(discarded),
    ]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: DISMISS }));
  });
});
