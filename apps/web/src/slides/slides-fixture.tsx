import { CourseId, LectureId, TagEdit, type TopicOrigin } from '@cram/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { ApiContext } from '../api/api-context';
import type { ApiClient } from '../api/api-client';
import { type Reply, retrievedSlide, type Sent } from '../api/api-fixture';
import { ADD_TAG } from '../copy';
import { SlidesScreen } from './SlidesScreen';

export const tag = (text: string, origin: TopicOrigin = 'student') => ({ tag: text, origin });

export const QUEEN = {
  ...retrievedSlide('l1/1', { slideNo: 1, title: 'The queen' }),
  chunks: [
    {
      chunkNo: 1,
      lines: ['One queen per colony', 'She lays every egg'],
      tags: [tag('castes'), tag('the queen', 'tagger')],
    },
  ],
};
export const COMB = {
  ...retrievedSlide('l1/2', { slideNo: 2, title: 'The comb', derived: true }),
  chunks: [
    { chunkNo: 1, lines: ['Cells are hexagonal.'], tags: [] },
    { chunkNo: 2, lines: [], tags: [tag('wax', 'tagger')] },
  ],
};
export const HELD = [tag('castes'), tag('the queen', 'tagger')];
export const LECTURE: Reply = { status: 200, body: { lectureId: 'l1', slides: [QUEEN, COMB] } };

export const isPut = ({ method }: Sent) => method === 'PUT';

/** Answers a tag edit with the list it asked for, each tag the student’s unless QUEEN’s tagger held it. */
export const echoed = (sent: Sent): Reply => {
  const { sourceId, chunkNo, tags } = TagEdit.parse(JSON.parse(sent.body));
  return {
    status: 200,
    body: {
      sourceId,
      chunkNo,
      tags: [...tags].sort().map((text) => tag(text, text === 'the queen' ? 'tagger' : 'student')),
    },
  };
};

export const renderSlides = (api: ApiClient) =>
  render(
    <ApiContext value={api}>
      <SlidesScreen courseId={CourseId.parse('bio')} lectureId={LectureId.parse('l1')} />
    </ApiContext>,
  );

export const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

export const tagsOn = (name: string): string[] =>
  within(screen.getByRole('list', { name: `Tags on ${name}` }))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('.tag-text')?.textContent ?? '');

export const addTag = async (name: string, text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Add a tag to ${name}` }), {
    target: { value: text },
  });
  fireEvent.click(
    within(
      screen.getByRole('textbox', { name: `Add a tag to ${name}` }).closest('form') ??
        document.body,
    ).getByRole('button', { name: ADD_TAG }),
  );
  await settle();
};

export const edits = (sent: readonly Sent[]) =>
  sent.filter(isPut).map(({ body }) => JSON.parse(body) as unknown);
