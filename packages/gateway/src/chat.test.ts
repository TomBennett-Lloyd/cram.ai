import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ChatWireRequest, chatResult, chatWireRequest, OutputName } from './chat';

const Answer = z.object({ text: z.string(), slide: z.number().int() });
const request = {
  messages: [{ role: 'user', content: 'What does slide 3 say?' }] as const,
  output: { name: OutputName.parse('answer'), schema: Answer },
};
const content = (text: string) => ({ status: 'content', content: text }) as const;

describe('chatResult', () => {
  it('completes with the parsed value when the reply satisfies the schema', () => {
    expect(chatResult(content('{"text":"x","slide":3}'), Answer)).toEqual({
      status: 'completed',
      value: { text: 'x', slide: 3 },
    });
  });

  it('reports a reply that is not JSON as invalid output, keeping the content', () => {
    const outcome = chatResult(content('<think>hm</think>{}'), Answer);
    expect(outcome).toMatchObject({ status: 'invalid-output', content: '<think>hm</think>{}' });
    expect(outcome.status === 'invalid-output' && outcome.issue).toMatch(/^not JSON/);
  });

  it('reports JSON that fails the schema as invalid output naming the field', () => {
    const outcome = chatResult(content('{"text":"x","slide":"three"}'), Answer);
    expect(outcome.status).toBe('invalid-output');
    expect(outcome.status === 'invalid-output' && outcome.issue).toMatch(/slide/);
  });

  it('reports a truncated reply as invalid output even when it parses', () => {
    expect(chatResult({ status: 'truncated', content: '{"text":"x","slide":3}' }, Answer)).toEqual({
      status: 'invalid-output',
      content: '{"text":"x","slide":3}',
      issue: 'cut off at the token limit',
    });
  });

  it('passes a backend failure through', () => {
    const reply = { status: 'backend-failed', reason: 'down' } as const;
    expect(chatResult(reply, Answer)).toEqual(reply);
  });
});

describe('chatWireRequest', () => {
  it('carries the messages and the JSON schema of the output', () => {
    const wire = chatWireRequest(request);
    expect(wire.messages).toEqual(request.messages);
    expect(wire.output.name).toBe('answer');
    expect(wire.output.jsonSchema).toMatchObject({ type: 'object', required: ['text', 'slide'] });
  });

  it('throws on a message field the types do not declare', () => {
    const messages = [{ ...request.messages[0], name: 'student' }] as const;
    expect(() => chatWireRequest({ ...request, messages })).toThrow(/name/);
  });
});

describe('OutputName and ChatWireRequest', () => {
  it.each(['answer', 'exam_question-2', 'a'.repeat(64)])('accept the output name %s', (name) => {
    expect(OutputName.safeParse(name).success).toBe(true);
  });

  it.each(['', 'an answer', 'a'.repeat(65), 'answer.v2'])('refuse the output name "%s"', (name) => {
    expect(OutputName.safeParse(name).success).toBe(false);
  });

  it('refuses a recorded request with no messages', () => {
    const wire = chatWireRequest(request);
    expect(ChatWireRequest.safeParse({ ...wire, messages: [] }).success).toBe(false);
  });
});
