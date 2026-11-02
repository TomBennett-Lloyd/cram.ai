import { CourseId, type Explanation } from '@cram/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/api-client';
import { ApiContext } from '../api/api-context';
import {
  COMB,
  CONTRADICTED,
  fakeApi,
  GROUNDED,
  HIVE,
  type Reply,
  retrievedSlide,
  sentence,
  WITHHELD,
} from '../api/api-fixture';
import {
  ATTRIBUTED_NOTE,
  contradictionRefLabel,
  MODEL_FAILED,
  NOT_COVERED,
  PENDING,
  SEARCHED_FOR,
  SLIDE_CONTRADICTION,
  SLIDE_HAS_NO_TEXT,
  sourceRefLabel,
} from '../copy';
import { AskScreen } from './AskScreen';

const renderAsk = (api: ApiClient) =>
  render(
    <ApiContext value={api}>
      <AskScreen courseId={CourseId.parse('bio')} />
    </ApiContext>,
  );

const askWith = async (reply: Reply, question = 'What are drones?') => {
  const { api, sent } = fakeApi(() => reply);
  const view = renderAsk(api);
  fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
    target: { value: question },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await Promise.resolve();
  });
  return { view, sent };
};

const answer = () => screen.getByRole('region', { name: 'Answer' });

/** A grounded reply over HIVE (s1) and COMB (s2) with the given explanation. */
const explained = (explanation: Explanation): Reply => ({
  status: 200,
  body: { ...GROUNDED, explanation },
});

describe('AskScreen', () => {
  it('mounts no live region and refuses a blank question', () => {
    const { api, sent } = fakeApi(() => ({ status: 200, body: GROUNDED }));
    renderAsk(api);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryAllByRole('status')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), {
      target: { value: '  ' },
    });
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty('disabled', true);
    expect(sent).toEqual([]);
  });

  it('renders the explanation at Ask’s depth, the attributed note beneath it', async () => {
    await askWith({ status: 200, body: GROUNDED });
    expect(within(answer()).getByText(ATTRIBUTED_NOTE)).toBeDefined();
  });

  it('opens the contradicting slide from its button, naming the sentence', async () => {
    await askWith(explained(CONTRADICTED));
    const button = within(answer()).getByRole('button', {
      name: contradictionRefLabel(1, HIVE.record),
    });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
    const line = dialog.querySelector('.slide-contradiction');
    expect(line?.textContent).toBe(`${SLIDE_CONTRADICTION} Drones forage for nectar.`);
    expect(line?.querySelector('.contradicted')?.textContent).toBe('Drones forage for nectar.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(button);
  });

  it('names no contradiction in a slide opened from its sources entry', async () => {
    await askWith(explained(CONTRADICTED));
    fireEvent.click(
      within(answer()).getAllByRole('button', { name: /Slide 4/ })[0] ?? document.body,
    );
    expect(screen.getByRole('dialog').querySelector('.slide-contradiction')).toBeNull();
  });

  it('moves focus from a number to its sources entry, which opens the slide with its quotes marked and takes focus back', async () => {
    await askWith({ status: 200, body: GROUNDED });
    const number = within(answer()).getByRole('button', { name: sourceRefLabel(2, COMB.record) });
    fireEvent.click(number);
    const entry = within(answer()).getByRole('button', { name: /Slide 7/ });
    expect(document.activeElement).toBe(entry);
    const hive = within(answer()).getByRole('button', { name: /Slide 4/ });
    hive.focus();
    fireEvent.click(hive);
    const dialog = screen.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
    expect(within(dialog).getByRole('heading', { level: 2 })).toBe(document.activeElement);
    expect([...dialog.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Drones are male.',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(hive);
  });

  it('closes the slide on Escape', async () => {
    await askWith({ status: 200, body: GROUNDED });
    fireEvent.click(within(answer()).getByRole('button', { name: /Slide 7/ }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('folds what was withheld, with the reason, apart from the answer', async () => {
    await askWith({ status: 200, body: GROUNDED });
    const panel = answer().querySelector('details');
    expect(panel?.open).toBe(false);
    expect(panel?.querySelector('summary')?.textContent).toBe('Withheld (1)');
    expect(panel?.textContent).toContain('Queens rule the hive.');
    expect(panel?.textContent).toContain('No slide this answer was written from says it.');
    expect(answer().querySelector('.explanation')?.textContent).not.toContain('Queens');
  });

  it('names what was searched when the reply corrected a typo, and nothing when it did not', async () => {
    const searched = 'What are drones?';
    const shown = () => answer().querySelector('.searched')?.textContent;
    const first = await askWith(
      { status: 200, body: { ...GROUNDED, searched } },
      'What are dornes?',
    );
    expect(shown()).toBe(`${SEARCHED_FOR} ${searched}`);
    expect(answer().querySelector('.searched q')?.textContent).toBe(searched);
    first.view.unmount();
    const second = await askWith({
      status: 200,
      body: { status: 'not-covered', withheld: [], slides: [], leftOut: [], searched },
    });
    expect(shown()).toBe(`${SEARCHED_FOR} ${searched}`);
    second.view.unmount();
    await askWith({ status: 200, body: GROUNDED });
    expect(answer().querySelector('.searched')).toBeNull();
  });

  it('shows no withheld panel when nothing was withheld', async () => {
    await askWith({ status: 200, body: { ...GROUNDED, withheld: [] } });
    expect(answer().querySelector('details')).toBeNull();
  });

  it('answers a question no slide supports with the fixed string and the closest slides', async () => {
    await askWith({
      status: 200,
      body: { status: 'not-covered', withheld: WITHHELD, slides: [COMB, HIVE], leftOut: [] },
    });
    expect(within(answer()).getByText(NOT_COVERED)).toBeDefined();
    const cards = within(answer())
      .getAllByRole('button')
      .map((card) => card.textContent);
    expect(cards).toEqual([
      'Lecture 1: The HiveSlide 7The comb',
      'Lecture 1: The HiveSlide 4Castes',
    ]);
    fireEvent.click(within(answer()).getAllByRole('button')[0] ?? document.body);
    expect(screen.getByRole('dialog').querySelectorAll('mark')).toHaveLength(0);
  });

  it('says a slide with no text has none to show', async () => {
    const blank = retrievedSlide('s3', { slideNo: 9, kind: 'image-only' });
    await askWith({
      status: 200,
      body: { status: 'not-covered', withheld: [], slides: [blank], leftOut: [] },
    });
    fireEvent.click(within(answer()).getByRole('button', { name: /Slide 9/ }));
    expect(screen.getByRole('dialog').textContent).toContain(SLIDE_HAS_NO_TEXT);
  });

  it('says so when the model failed', async () => {
    await askWith({ status: 502, body: { status: 'model-failed' } });
    expect(screen.getByRole('alert').textContent).toBe(MODEL_FAILED);
  });

  it('names the token limit when the question is too long', async () => {
    await askWith({ status: 422, body: { status: 'question-over-length', maxInputTokens: 512 } });
    expect(screen.getByRole('alert').textContent).toContain('at most 512 tokens');
  });

  it('marks a slide a sentence names but the reply did not return as missing', async () => {
    const explanation = {
      ...GROUNDED.explanation,
      sentences: [sentence('Drones are male.', ['s9'])],
    };
    await askWith({ status: 200, body: { ...GROUNDED, explanation } });
    expect(within(answer()).getByText('Source not returned')).toBeDefined();
  });

  it('shows the pending label while the server answers, and drops a reply a newer question replaced', async () => {
    const resolvers: ((reply: Reply) => void)[] = [];
    const { api } = fakeApi(() => new Promise<Reply>((resolve) => resolvers.push(resolve)));
    renderAsk(api);
    const input = screen.getByRole('textbox', { name: 'Question' });
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(answer().querySelector('[aria-busy="true"]')?.textContent).toBe(PENDING.answer);
    fireEvent.change(input, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(resolvers).toHaveLength(2);
      resolvers[1]?.({ status: 502, body: { status: 'model-failed' } });
      await Promise.resolve();
      resolvers[0]?.({ status: 200, body: GROUNDED });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('alert').textContent).toBe(MODEL_FAILED);
    expect(answer().querySelector('.explanation')).toBeNull();
  });
});
