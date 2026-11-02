import { StoredLectures } from '@cram/shared';
import { act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { HIVE, type Reply, type Sent } from '../api/api-fixture';
import { lecture, reads } from './decks-fixture';

export const stored = (summarised: boolean) =>
  StoredLectures.parse({
    state: 'read',
    lectures: [lecture('l1', 2, [], [], summarised)],
    report: { state: 'none' },
  });

export const SUMMARIES: Reply = {
  status: 200,
  body: {
    state: 'read',
    summaries: [
      {
        lectureId: 'l1',
        units: [
          {
            text: 'Workers are female.',
            citations: [{ sourceId: 's1', quote: 'Worker bees are female.' }],
            kind: 'lecture-summary',
          },
        ],
      },
    ],
    slides: [HIVE],
  },
};

export const isSummaries = ({ path }: Sent) => path === '/courses/bio/summaries';
export const isRemake = ({ path, method }: Sent) =>
  method === 'POST' && path === '/courses/bio/remakes';
export const statusReads = (sent: readonly Sent[]) =>
  reads(sent.filter((each) => !isSummaries(each)));

export const openSummary = async () => {
  const details = document.querySelector('details.lecture-summary');
  if (!(details instanceof HTMLDetailsElement)) throw new Error('no summary disclosure');
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await vi.advanceTimersByTimeAsync(0);
  });
  return details;
};
