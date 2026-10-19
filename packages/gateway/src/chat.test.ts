import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatOutcome, chatWireRequest } from './chat';

const Answer = z.object({ text: z.string(), slide: z.number().int() });
const request = {
  messages: [{ role: 'user' as const, content: 'What does slide 3 say?' }],
  output: { name: 'answer', schema: Answer },
};

describe('chatOutcome', () => {
  it('completes with the parsed value when the reply satisfies the schema', () => {
    expect(chatOutcome('{"text":"x","slide":3}', Answer)).toEqual({
      status: 'completed',
      value: { text: 'x', slide: 3 },
    });
  });

  it('reports a reply that is not JSON as invalid output, keeping the content', () => {
    const outcome = chatOutcome('<think>hm</think>{}', Answer);
    expect(outcome).toMatchObject({ status: 'invalid-output', content: '<think>hm</think>{}' });
    expect(outcome.status === 'invalid-output' && outcome.issue).toMatch(/^not JSON/);
  });

  it('reports JSON that fails the schema as invalid output naming the field', () => {
    const outcome = chatOutcome('{"text":"x","slide":"three"}', Answer);
    expect(outcome.status).toBe('invalid-output');
    expect(outcome.status === 'invalid-output' && outcome.issue).toMatch(/slide/);
  });
});

describe('chatWireRequest', () => {
  it('carries the messages and the JSON schema of the output', () => {
    const wire = chatWireRequest(request);
    expect(wire.messages).toEqual(request.messages);
    expect(wire.output.name).toBe('answer');
    expect(wire.output.jsonSchema).toMatchObject({
      type: 'object',
      required: ['text', 'slide'],
    });
  });

  it('throws on an output name a backend would refuse', () => {
    expect(() =>
      chatWireRequest({ ...request, output: { ...request.output, name: 'an answer' } }),
    ).toThrow();
  });

  it('throws on a request with no messages', () => {
    expect(() => chatWireRequest({ ...request, messages: [] })).toThrow();
  });
});
