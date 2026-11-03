import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../api/api-fixture';
import {
  addTag,
  echoed,
  edits,
  HELD,
  isPut,
  LECTURE,
  renderSlides,
  settle,
  tag,
  tagsOn,
} from './slides-fixture';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useChunkTags', () => {
  it('writes edits one at a time, sending only the latest list once the write in flight returns', async () => {
    const gates: (() => void)[] = [];
    const { api, sent } = fakeApi(async (request) => {
      if (!isPut(request)) return LECTURE;
      await new Promise<void>((resolve) => gates.push(resolve));
      return echoed(request);
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'one');
    await addTag('slide 1', 'two');
    await addTag('slide 1', 'three');
    const shown = ['castes', 'one', 'the queen', 'three', 'two'];
    expect(tagsOn('slide 1')).toEqual(shown);
    expect(
      screen
        .getByRole('button', { name: 'Remove the tag one' })
        .closest('.tag')
        ?.getAttribute('data-origin'),
    ).toBe('student');
    expect(edits(sent)).toHaveLength(1);
    gates[0]?.();
    await settle();
    expect(tagsOn('slide 1')).toEqual(shown);
    gates[1]?.();
    await settle();
    expect(edits(sent)).toEqual([
      { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags: ['castes', 'the queen', 'one'] },
      {
        sourceId: 'l1/1',
        chunkNo: 1,
        base: [tag('castes'), tag('one'), tag('the queen', 'tagger')],
        tags: ['castes', 'one', 'the queen', 'two', 'three'],
      },
    ]);
    expect(tagsOn('slide 1')).toEqual(shown);
  });

  it('puts the stored list back and says why when a write is refused, and clears the alert at the next edit', async () => {
    let refuse = true;
    const { api } = fakeApi((request) => {
      if (!isPut(request)) return LECTURE;
      return refuse
        ? { status: 409, body: { status: 'course-unavailable', problem: 'newer-schema' } }
        : echoed(request);
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'royal jelly');
    expect(tagsOn('slide 1')).toEqual(['castes', 'the queen']);
    expect(screen.getByRole('alert').textContent).toMatch(/newer version of cram.ai/);
    refuse = false;
    await addTag('slide 1', 'drones');
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(tagsOn('slide 1')).toEqual(['castes', 'drones', 'the queen']);
    refuse = true;
    await addTag('slide 1', 'swarming');
    expect(tagsOn('slide 1')).toEqual(['castes', 'drones', 'the queen']);
  });

  it('drops an edit queued behind a write that is refused, showing the stored list and why', async () => {
    let refuse: () => void = () => undefined;
    const { api, sent } = fakeApi(async (request) => {
      if (!isPut(request)) return LECTURE;
      await new Promise<void>((resolve) => {
        refuse = resolve;
      });
      return { status: 409, body: { status: 'course-unavailable', problem: 'newer-schema' } };
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'one');
    await addTag('slide 1', 'two');
    refuse();
    await settle();
    expect(edits(sent)).toHaveLength(1);
    expect(tagsOn('slide 1')).toEqual(['castes', 'the queen']);
    expect(screen.getByRole('alert').textContent).toMatch(/newer version of cram.ai/);
  });

  it('shows the stored list a write made against another is refused with, drops the edit queued behind it, and says why', async () => {
    const changed = [tag('drones'), tag('the queen', 'tagger')];
    let refuse: () => void = () => undefined;
    const { api, sent } = fakeApi(async (request) => {
      if (!isPut(request)) return LECTURE;
      await new Promise<void>((resolve) => {
        refuse = resolve;
      });
      return { status: 409, body: { status: 'tags-changed', tags: changed } };
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'one');
    await addTag('slide 1', 'two');
    refuse();
    await settle();
    expect(edits(sent)).toHaveLength(1);
    expect(tagsOn('slide 1')).toEqual(['drones', 'the queen']);
    expect(tagsOn('slide 2, part 2')).toEqual(['wax']);
    expect(screen.getByRole('alert').textContent).toBe(
      'These tags changed since this page loaded, so that edit wasn’t saved. They’re shown as they are now.',
    );
  });

  it('makes the edit after a refused one against the list the refusal carried', async () => {
    const changed = [tag('drones'), tag('the queen', 'tagger')];
    let refuse = true;
    const { api, sent } = fakeApi((request) => {
      if (!isPut(request)) return LECTURE;
      if (!refuse) return echoed(request);
      refuse = false;
      return { status: 409, body: { status: 'tags-changed', tags: changed } };
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'one');
    await addTag('slide 1', 'two');
    expect(edits(sent)).toEqual([
      { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags: ['castes', 'the queen', 'one'] },
      { sourceId: 'l1/1', chunkNo: 1, base: changed, tags: ['drones', 'the queen', 'two'] },
    ]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('keeps the list last stored as the base after a refusal that carries none', async () => {
    let refuse = true;
    const { api, sent } = fakeApi((request) => {
      if (!isPut(request)) return LECTURE;
      if (!refuse) return echoed(request);
      refuse = false;
      return { status: 409, body: { status: 'course-unavailable', problem: 'newer-schema' } };
    });
    renderSlides(api);
    await settle();
    await addTag('slide 1', 'one');
    await addTag('slide 1', 'two');
    expect(edits(sent)).toEqual([
      { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags: ['castes', 'the queen', 'one'] },
      { sourceId: 'l1/1', chunkNo: 1, base: HELD, tags: ['castes', 'the queen', 'two'] },
    ]);
  });
});
