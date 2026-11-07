import type { ChatResult, GeneratorReply } from '@cram/gateway';
import type { AskTurn } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { fakeGateway, generatorRecording, generatorReplies } from './fake-gateway-fixture';
import { standaloneRequest } from './prompts/standalone-question-prompt';
import { standaloneQuestion } from './standalone-question';

const TURNS: readonly AskTurn[] = [
  { question: 'Who are the workers?', answer: 'The workers are male.' },
];
const FOLLOW_UP = 'And the drones?';

describe('standaloneQuestion', () => {
  it('returns the model’s standalone question', async () => {
    const { generator } = fakeGateway([
      generatorReplies(standaloneRequest(FOLLOW_UP, TURNS), {
        question: 'Who are the drones?',
      }),
    ]);
    await expect(standaloneQuestion(FOLLOW_UP, TURNS, generator)).resolves.toEqual({
      status: 'rewritten',
      question: 'Who are the drones?',
    });
  });

  it.each<[string, GeneratorReply, ChatResult<unknown>['status']]>([
    ['an invalid reply', { status: 'content', content: '{"question":" "}' }, 'invalid-output'],
    [
      'a cut-off reply',
      { status: 'truncated', content: '{"quest', cutOffAt: 'token-limit' },
      'cut-off',
    ],
    [
      'a failed backend',
      { status: 'backend-failed', cause: 'request-error', reason: 'down' },
      'backend-failed',
    ],
  ])('reports %s as a model failure', async (_, reply, status) => {
    const { generator } = fakeGateway([
      generatorRecording(standaloneRequest(FOLLOW_UP, TURNS), reply),
    ]);
    const outcome = await standaloneQuestion(FOLLOW_UP, TURNS, generator);
    expect(outcome).toMatchObject({ status: 'model-failed', failure: { status } });
  });

  it('refuses a question with no earlier turn, which is no follow-up', async () => {
    const { generator } = fakeGateway([]);
    await expect(standaloneQuestion(FOLLOW_UP, [], generator)).rejects.toThrow(/no earlier turn/);
  });
});
