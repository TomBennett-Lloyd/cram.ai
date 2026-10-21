import { CourseId, CourseRepair, StoredLecture, StoredLectures, Upload } from '@cram/shared';
import { act, render } from '@testing-library/react';
import { vi } from 'vitest';
import type { ApiClient } from '../api/api-client';
import { ApiContext } from '../api/api-context';
import type { Reply, Sent } from '../api/api-fixture';
import { DecksScreen } from './DecksScreen';

/** Parsed, so a fixture the server could not send fails here rather than in the screen. */
export const upload = (fileName: string, progress: unknown): Upload =>
  Upload.parse({ uploadId: fileName, lectureId: fileName, fileName, progress });

const NOTHING_STORED = StoredLectures.parse({ state: 'read', lectures: [], discarded: [] });

const NO_REPAIR = CourseRepair.parse({ state: 'none' });

export const repairStatus = (
  stored: StoredLectures,
  repair: CourseRepair,
  ...uploads: Upload[]
): Reply => ({
  status: 200,
  body: { courseId: 'bio', stored, repair, uploads },
});

export const storedStatus = (stored: StoredLectures, ...uploads: Upload[]): Reply =>
  repairStatus(stored, NO_REPAIR, ...uploads);

export const status = (...uploads: Upload[]): Reply => storedStatus(NOTHING_STORED, ...uploads);

export const lecture = (
  lectureId: string,
  slideCount: number,
  imageOnly: number[],
): StoredLecture =>
  StoredLecture.parse({ lectureId, lectureTitle: `Title of ${lectureId}`, slideCount, imageOnly });

export const rows = () =>
  [...document.querySelectorAll('.upload')].map((row) =>
    [...row.children].map((node) => node.textContent),
  );

export const renderDecks = (api: ApiClient) =>
  render(
    <ApiContext value={api}>
      <DecksScreen courseId={CourseId.parse('bio')} />
    </ApiContext>,
  );

/** Runs the screen's pending reads under fake timers. */
export const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

export const reads = (sent: readonly Sent[]) =>
  sent.filter(({ method }) => method === 'GET').length;
