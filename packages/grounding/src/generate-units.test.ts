import { describe, expect, it } from 'vitest';
import {
  answer,
  cite,
  fakeGateway,
  generatorRecording,
  generatorReplies,
  slide,
} from './fake-gateway-fixture';
import { generateUnits } from './generate-units';
import { generationRequest } from './prompts/generation-prompt';

const task = { kind: 'answer-sentence', question: 'Who are the workers?' } as const;
const slides = [slide('l1/1', 'Worker bees are male.')];
const request = generationRequest(task, slides);

describe('generateUnits', () => {
  it('returns the model’s units with the task’s kind', async () => {
    const units = [
      { text: 'Workers are male.', citations: [cite('l1/1', 'Worker bees are male.')] },
    ];
    const gateway = fakeGateway([generatorReplies(request, { units })]);
    await expect(generateUnits(task, slides, gateway.generator)).resolves.toEqual({
      status: 'generated',
      units: [answer('Workers are male.', [cite('l1/1', 'Worker bees are male.')])],
    });
  });

  it('returns no units when the model finds the sources do not cover the request', async () => {
    const gateway = fakeGateway([generatorReplies(request, { units: [] })]);
    await expect(generateUnits(task, slides, gateway.generator)).resolves.toEqual({
      status: 'generated',
      units: [],
    });
  });

  it('reports a backend failure as a value', async () => {
    const reply = { status: 'backend-failed', reason: 'connection refused' } as const;
    const gateway = fakeGateway([generatorRecording(request, reply)]);
    await expect(generateUnits(task, slides, gateway.generator)).resolves.toEqual({
      status: 'model-failed',
      failure: reply,
    });
  });

  it('reports output that fails the units schema as a value', async () => {
    const gateway = fakeGateway([
      generatorReplies(request, { units: [{ text: ' ', citations: [] }] }),
    ]);
    await expect(generateUnits(task, slides, gateway.generator)).resolves.toMatchObject({
      status: 'model-failed',
      failure: { status: 'invalid-output' },
    });
  });
});
