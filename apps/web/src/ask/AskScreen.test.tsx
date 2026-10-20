import { CourseId } from '@cram/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/api-client';
import { ApiContext } from '../api/api-context';
import {
  answerUnit,
  COMB,
  fakeApi,
  GROUNDED,
  HIVE,
  type Reply,
  retrievedSlide,
  WITHHELD,
} from '../api/api-fixture';
import { MODEL_FAILED, NOT_COVERED, PENDING, SLIDE_HAS_NO_TEXT } from '../copy';
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

  it('shows each answer unit with a card per cited slide', async () => {
    await askWith({ status: 200, body: GROUNDED });
    const units = within(answer())
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('unit'));
    expect(units.map((unit) => unit.querySelector('.unit-text')?.textContent)).toEqual([
      'Workers are female.',
      'Drones are male, and comb cells are hexagonal.',
    ]);
    const cards = (index: number) =>
      within(units[index] ?? document.body)
        .getAllByRole('button')
        .map((card) => card.textContent);
    expect(cards(0)).toEqual(['Lecture 1: The HiveSlide 4Castes']);
    expect(cards(1)).toEqual([
      'Lecture 1: The HiveSlide 4Castes',
      'Lecture 1: The HiveSlide 7The comb',
    ]);
  });

  it('opens a cited slide with the unit’s quotes marked, and returns focus to its card on close', async () => {
    await askWith({ status: 200, body: GROUNDED });
    const card = within(answer()).getAllByRole('button', { name: /Slide 4/ })[1];
    if (card === undefined) throw new Error('no second card for slide 4');
    card.focus();
    fireEvent.click(card);
    const dialog = screen.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
    expect(within(dialog).getByRole('heading', { level: 2 })).toBe(document.activeElement);
    expect([...dialog.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
      'Drones are male.',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it('closes the slide on Escape', async () => {
    await askWith({ status: 200, body: GROUNDED });
    fireEvent.click(
      within(answer()).getAllByRole('button', { name: /Slide 7/ })[0] ?? document.body,
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('folds what was withheld, with the reason, apart from the answer', async () => {
    await askWith({ status: 200, body: GROUNDED });
    const panel = answer().querySelector('details');
    expect(panel?.open).toBe(false);
    expect(panel?.querySelector('summary')?.textContent).toBe('Withheld (1)');
    expect(panel?.textContent).toContain('Queens rule the hive.');
    expect(panel?.textContent).toContain('The cited slides don’t support it.');
    expect(answer().querySelector('.answer')?.textContent).not.toContain('Queens');
  });

  it('shows no withheld panel when nothing was withheld', async () => {
    await askWith({ status: 200, body: { ...GROUNDED, withheld: [] } });
    expect(answer().querySelector('details')).toBeNull();
  });

  it('answers a question no slide supports with the fixed string and the closest slides', async () => {
    await askWith({
      status: 200,
      body: { status: 'not-covered', withheld: WITHHELD, slides: [COMB, HIVE] },
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
    await askWith({ status: 200, body: { status: 'not-covered', withheld: [], slides: [blank] } });
    fireEvent.click(within(answer()).getByRole('button', { name: /Slide 9/ }));
    expect(screen.getByRole('dialog').textContent).toContain(SLIDE_HAS_NO_TEXT);
  });

  it('says so when the model failed, and when the server refused the question', async () => {
    await askWith({ status: 502, body: { status: 'model-failed' } });
    expect(screen.getByRole('alert').textContent).toBe(MODEL_FAILED);
  });

  it('names the token limit when the question is too long', async () => {
    await askWith({ status: 422, body: { status: 'question-over-length', maxInputTokens: 512 } });
    expect(screen.getByRole('alert').textContent).toContain('at most 512 tokens');
  });

  it('marks a citation whose slide the reply did not return as missing', async () => {
    const shown = [answerUnit('Drones are male.', [['s9', 'Drones are male.']])];
    await askWith({ status: 200, body: { ...GROUNDED, shown } });
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
      resolvers[1]?.({ status: 502, body: { status: 'model-failed' } });
      await Promise.resolve();
      resolvers[0]?.({ status: 200, body: GROUNDED });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('alert').textContent).toBe(MODEL_FAILED);
    expect(answer().querySelector('.answer')).toBeNull();
  });
});
