import { CourseId } from '@cram/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../api/api-context';
import { fakeApi, GROUNDED, type Reply } from '../api/api-fixture';
import { MODEL_FAILED, NEW_QUESTION, PENDING } from '../copy';
import { AskScreen } from './AskScreen';

const NOT_COVERED_REPLY: Reply = {
  status: 200,
  body: { status: 'not-covered', withheld: [], slides: [], leftOut: [] },
};
const MODEL_FAILED_REPLY: Reply = { status: 502, body: { status: 'model-failed' } };
const GROUNDED_REPLY: Reply = { status: 200, body: GROUNDED };
const MALFORMED_REPLY: Reply = { status: 500, body: {} };

/** A screen whose server answers the `n`th ask with `replies[n]`, the last reply thereafter. */
const thread = (replies: readonly (Reply | Promise<Reply>)[]) => {
  const { api, sent } = fakeApi(
    () => replies[Math.min(sent.length - 1, replies.length - 1)] ?? GROUNDED_REPLY,
  );
  render(
    <ApiContext value={api}>
      <AskScreen courseId={CourseId.parse('bio')} />
    </ApiContext>,
  );
  const textbox = () => screen.getByRole('textbox', { name: 'Question' });
  const ask = async (question: string) => {
    fireEvent.change(textbox(), { target: { value: question } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const turnsSent = (at: number): unknown => {
    const body: unknown = JSON.parse(sent[at]?.body ?? '{}');
    return typeof body === 'object' && body !== null && 'turns' in body ? body.turns : undefined;
  };
  return { ask, textbox, turnsSent };
};

const region = () => screen.getByRole('region', { name: 'Answer' });
const exchanges = () => [...region().querySelectorAll('.exchange')];

/** `docs/adr/0011-ask-conversation.md` § Decision (a), (f). */
describe('AskScreen’s thread', () => {
  it('sends each shown answer as a turn, renders every exchange, and clears the textbox', async () => {
    const { ask, textbox, turnsSent } = thread([GROUNDED_REPLY]);
    await ask('What are drones?');
    expect(textbox()).toHaveProperty('value', '');
    await ask('And the workers?');
    expect(textbox()).toHaveProperty('value', '');
    expect(turnsSent(0)).toEqual([]);
    expect(turnsSent(1)).toEqual([
      { question: 'What are drones?', answer: GROUNDED.explanation.text },
    ]);
    expect(
      exchanges().map((item) => item.querySelector('.exchange-question')?.textContent),
    ).toEqual(['What are drones?', 'And the workers?']);
    for (const item of exchanges()) expect(item.querySelector('.explanation-text')).not.toBeNull();
  });

  it('carries a not-covered reply as a turn with no answer', async () => {
    const { ask, turnsSent } = thread([NOT_COVERED_REPLY, GROUNDED_REPLY]);
    await ask('Who wrote Hamlet?');
    await ask('And Macbeth?');
    expect(turnsSent(1)).toEqual([{ question: 'Who wrote Hamlet?', answer: null }]);
  });

  it('never carries a failed exchange, and keeps showing it', async () => {
    const { ask, turnsSent } = thread([MODEL_FAILED_REPLY, GROUNDED_REPLY]);
    await ask('What are drones?');
    await ask('What are drones, again?');
    expect(turnsSent(1)).toEqual([]);
    const [failed] = exchanges();
    expect(failed?.querySelector('[role="alert"]')?.textContent).toBe(MODEL_FAILED);
  });

  it('never carries an exchange the server did not answer', async () => {
    const { ask, turnsSent } = thread([MALFORMED_REPLY, GROUNDED_REPLY]);
    await ask('What are drones?');
    await ask('What are drones, again?');
    expect(turnsSent(1)).toEqual([]);
  });

  it('replaces a pending exchange with a newer question, carrying neither', async () => {
    const { ask, turnsSent } = thread([new Promise<Reply>(() => undefined), GROUNDED_REPLY]);
    await ask('What are drones?');
    await ask('Who are the workers?');
    expect(turnsSent(1)).toEqual([]);
    expect(
      exchanges().map((item) => item.querySelector('.exchange-question')?.textContent),
    ).toEqual(['Who are the workers?']);
  });

  it('offers a new question once a thread exists, which empties it and the next turns', async () => {
    const { ask, turnsSent } = thread([GROUNDED_REPLY]);
    expect(screen.queryByRole('button', { name: NEW_QUESTION })).toBeNull();
    await ask('What are drones?');
    fireEvent.click(screen.getByRole('button', { name: NEW_QUESTION }));
    expect(exchanges()).toEqual([]);
    expect(screen.queryByRole('button', { name: NEW_QUESTION })).toBeNull();
    await ask('Who are the workers?');
    expect(turnsSent(1)).toEqual([]);
  });

  it('drops a reply that lands after New question was pressed', async () => {
    let land: (reply: Reply) => void = () => undefined;
    const { ask } = thread([new Promise<Reply>((resolve) => (land = resolve))]);
    await ask('What are drones?');
    fireEvent.click(screen.getByRole('button', { name: NEW_QUESTION }));
    await act(async () => {
      land(GROUNDED_REPLY);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(exchanges()).toEqual([]);
  });

  it('shows a pending answer under its question, the earlier exchange still shown', async () => {
    const { ask } = thread([GROUNDED_REPLY, new Promise<Reply>(() => undefined)]);
    await ask('What are drones?');
    await ask('And the workers?');
    const [first, second] = exchanges();
    expect(first?.querySelector('.explanation-text')).not.toBeNull();
    expect(second?.querySelector('.exchange-question')?.textContent).toBe('And the workers?');
    expect(second?.querySelector('[aria-busy="true"]')?.textContent).toBe(PENDING.answer);
  });
});
