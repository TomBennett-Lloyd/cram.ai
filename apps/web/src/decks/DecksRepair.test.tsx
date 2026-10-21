import { CourseRepair, StoredLectures } from '@cram/shared';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type Reply } from '../api/api-fixture';
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
  const SHOWN = 'a'.repeat(64);
  const storedWith = (report: unknown) =>
    StoredLectures.parse({ state: 'read', lectures: [lecture('l1', 2, [])], report });
  const STORED = storedWith({ state: 'none' });
  const undismissed = (discarded: unknown[], revision = SHOWN) =>
    storedWith({ state: 'undismissed', discarded, revision });
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
      'This course’s file was saved by an older version of cram.ai and couldn’t be updated, so its stored decks can’t be listed.',
    );
  });

  const DISCARDED = [{ table: 'topics', rows: 12 }];
  const DISMISSED = { status: 200, body: { status: 'dismissed' } };
  const reported = (onDelete: () => Reply | Promise<Reply>) =>
    fakeApi(({ method }) =>
      method === 'DELETE'
        ? onDelete()
        : repairStatus(undismissed(DISCARDED), repair({ state: 'done' })),
    );
  const dismissButton = () => screen.getByRole('button', { name: DISMISS });

  it('tells the student what a rebuild lost, beside the lectures it kept, until they dismiss it', async () => {
    const { api, sent } = reported(() => DISMISSED);
    renderDecks(api);
    await settle();
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
      discardedMessage(DISCARDED),
    );
    expect(discardedMessage(DISCARDED)).toMatch(/^This course was rebuilt from its stored decks/);
    expect(rows()).toEqual([['l1', '2 slides indexed.']]);
    dismissButton().focus();
    fireEvent.click(dismissButton());
    await settle();
    expect(sent.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/courses/bio/rebuild-report?revision=${SHOWN}`,
    });
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(document.activeElement).toBe(screen.getByLabelText('Add decks'));
    expect(reads(sent)).toBe(1);
  });

  it('lands on the picker when the focus fell to the page while the dismissal waited', async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const { api } = reported(
      () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    );
    renderDecks(api);
    await settle();
    dismissButton().focus();
    fireEvent.click(dismissButton());
    await settle();
    dismissButton().blur();
    answer(DISMISSED);
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText('Add decks'));
  });

  it('says the dismissal is under way, takes no second press, and leaves the focus where the reader moved it', async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const { api, sent } = reported(
      () =>
        new Promise<Reply>((resolve) => {
          answer = resolve;
        }),
    );
    renderDecks(api);
    await settle();
    dismissButton().focus();
    fireEvent.click(dismissButton());
    await settle();
    expect(busy()).toEqual([PENDING.dismissal]);
    expect(dismissButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(dismissButton());
    await settle();
    expect(sent.filter(({ method }) => method === 'DELETE')).toHaveLength(1);
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    answer(DISMISSED);
    await settle();
    expect(busy()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('keeps the notice, and says why, when the dismissal is refused', async () => {
    const { api, sent } = reported(() => ({
      status: 409,
      body: { status: 'course-unavailable', problem: 'newer-schema' },
    }));
    renderDecks(api);
    await settle();
    dismissButton().focus();
    fireEvent.click(dismissButton());
    await settle();
    expect([...screen.getByRole('alert').querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'This course’s file was saved by a newer version of cram.ai.',
      discardedMessage(DISCARDED),
    ]);
    expect(document.activeElement).toBe(dismissButton());
    expect(dismissButton().getAttribute('aria-disabled')).toBe('false');
    expect(reads(sent)).toBe(1);
  });

  it('re-reads, and shows the later report, when the one dismissed is no longer the file’s', async () => {
    const LATER = [{ table: 'topics', rows: 14 }];
    let rebuiltAgain = false;
    const { api, sent } = fakeApi(({ method, path }) => {
      if (method === 'DELETE') {
        if (path.endsWith(SHOWN)) return { status: 409, body: { status: 'report-changed' } };
        return DISMISSED;
      }
      return repairStatus(
        rebuiltAgain ? undismissed(LATER, 'b'.repeat(64)) : undismissed(DISCARDED),
        repair({ state: 'done' }),
      );
    });
    renderDecks(api);
    await settle();
    rebuiltAgain = true;
    fireEvent.click(dismissButton());
    await settle();
    expect(reads(sent)).toBe(2);
    expect([...screen.getByRole('alert').querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'This course was rebuilt again since that notice was shown, so it now lists more. Read it before dismissing it.',
      discardedMessage(LATER),
    ]);
    fireEvent.click(dismissButton());
    await settle();
    expect(sent.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/courses/bio/rebuild-report?revision=${'b'.repeat(64)}`,
    });
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('shows a later report after an earlier one was dismissed', async () => {
    let rebuiltAgain = false;
    const { api } = fakeApi(({ method }) =>
      method === 'DELETE'
        ? DISMISSED
        : repairStatus(
            rebuiltAgain ? undismissed(DISCARDED, 'b'.repeat(64)) : undismissed(DISCARDED),
            repair({ state: rebuiltAgain ? 'running' : 'done' }),
          ),
    );
    renderDecks(api);
    await settle();
    fireEvent.click(dismissButton());
    await settle();
    expect(screen.queryAllByRole('alert')).toEqual([]);
    rebuiltAgain = true;
    fireEvent.change(screen.getByLabelText('Add decks'), { target: { files: [] } });
    await settle();
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(
      discardedMessage(DISCARDED),
    );
  });
});
