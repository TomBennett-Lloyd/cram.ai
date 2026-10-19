import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest } from './chat';
import { FakeGateway, RecordingMissError } from './fake-gateway';
import { RerankerPin } from './pin';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';
import type { Recording } from './recording';

const pins = PROVISIONAL_DEFAULT_PINS;
const rerankerPin = RerankerPin.parse({ ...pins.embedder, role: 'reranker' });

const Answer = z.object({ text: z.string() });
const ask = (content: string) => ({
  messages: [{ role: 'user' as const, content }],
  output: { name: 'answer', schema: Answer },
});
const generatorRecording = (
  content: string,
  reply: Extract<Recording, { role: 'generator' }>['reply'],
): Recording => ({
  role: 'generator',
  pin: pins.generator,
  request: chatWireRequest(ask(content)),
  reply,
});

const gateway = (recordings: readonly Recording[]) => new FakeGateway({ pins, recordings });

describe('FakeGateway generator', () => {
  it('replays recorded content through the schema', async () => {
    const fake = gateway([generatorRecording('q', { status: 'content', content: '{"text":"a"}' })]);
    await expect(fake.generator.chat(ask('q'))).resolves.toEqual({
      status: 'completed',
      value: { text: 'a' },
    });
  });

  it('replays content that fails the schema as invalid output', async () => {
    const fake = gateway([generatorRecording('q', { status: 'content', content: '{"text":1}' })]);
    await expect(fake.generator.chat(ask('q'))).resolves.toMatchObject({
      status: 'invalid-output',
    });
  });

  it('replays a recorded backend failure', async () => {
    const reply = { status: 'backend-failed', reason: 'connection refused' } as const;
    const fake = gateway([generatorRecording('q', reply)]);
    await expect(fake.generator.chat(ask('q'))).resolves.toEqual(reply);
  });

  it('rejects with a miss on a prompt it has no recording for', async () => {
    const fake = gateway([generatorRecording('q', { status: 'content', content: '{}' })]);
    const miss = fake.generator.chat(ask('q2'));
    await expect(miss).rejects.toBeInstanceOf(RecordingMissError);
    await expect(miss).rejects.toMatchObject({ role: 'generator' });
  });

  it('rejects with a miss when the output schema differs', async () => {
    const fake = gateway([generatorRecording('q', { status: 'content', content: '{}' })]);
    const other = {
      ...ask('q'),
      output: { name: 'answer', schema: z.object({ text: z.number() }) },
    };
    await expect(fake.generator.chat(other)).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('rejects with a miss when the recording was made under another pin', async () => {
    const recording = generatorRecording('q', { status: 'content', content: '{"text":"a"}' });
    const fake = new FakeGateway({
      pins: { ...pins, generator: { ...pins.generator, sha256: 'f'.repeat(64) } },
      recordings: [recording],
    });
    await expect(fake.generator.chat(ask('q'))).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('matches a recording whose keys were written in another order', async () => {
    const wire = chatWireRequest(ask('q'));
    const reordered: Recording = {
      reply: { content: '{"text":"a"}', status: 'content' },
      request: {
        output: { jsonSchema: wire.output.jsonSchema, name: wire.output.name },
        messages: wire.messages.map(({ content, role }) => ({ content, role })),
      },
      pin: { ...pins.generator },
      role: 'generator',
    };
    await expect(gateway([reordered]).generator.chat(ask('q'))).resolves.toMatchObject({
      status: 'completed',
    });
  });
});

describe('FakeGateway encoders', () => {
  it('replays one Float32Array per embedded text', async () => {
    const fake = gateway([
      {
        role: 'embedder',
        pin: pins.embedder,
        request: { texts: ['a', 'b'] },
        reply: {
          vectors: [
            [0.5, 1],
            [0, -1],
          ],
        },
      },
    ]);
    const vectors = await fake.embedder.embed({ texts: ['a', 'b'] });
    expect(vectors).toEqual([Float32Array.from([0.5, 1]), Float32Array.from([0, -1])]);
    await expect(fake.embedder.embed({ texts: ['b', 'a'] })).rejects.toBeInstanceOf(
      RecordingMissError,
    );
  });

  it('replays entailment scores and over-length results', async () => {
    const results = [
      { status: 'scored', scores: { entailment: 0.9, neutral: 0.08, contradiction: 0.02 } },
      { status: 'over-length', inputTokens: 700, maxInputTokens: 512 },
    ] as const;
    const pairs = [
      { premise: 'p', hypothesis: 'h' },
      { premise: 'long', hypothesis: 'h' },
    ];
    const fake = gateway([
      {
        role: 'verifier',
        pin: pins.verifier,
        request: { pairs },
        reply: { results: [...results] },
      },
    ]);
    await expect(fake.verifier.entail({ pairs })).resolves.toEqual(results);
  });

  it('has no reranker unless one is pinned', () => {
    expect(gateway([]).reranker).toBeNull();
  });

  it('replays rerank scores when a reranker is pinned', async () => {
    const request = { query: 'q', documents: ['d1', 'd2'] };
    const fake = new FakeGateway({
      pins: { ...pins, reranker: rerankerPin },
      recordings: [{ role: 'reranker', pin: rerankerPin, request, reply: { scores: [2, -1] } }],
    });
    await expect(fake.reranker?.rerank(request)).resolves.toEqual([2, -1]);
  });

  it('rejects a request carrying a field its schema does not have, for every encoder', async () => {
    const fake = new FakeGateway({ pins: { ...pins, reranker: rerankerPin }, recordings: [] });
    const extra = { truncate: true };
    await expect(fake.embedder.embed({ texts: ['a'], ...extra })).rejects.toThrow(/truncate/);
    await expect(fake.reranker?.rerank({ query: 'q', documents: [], ...extra })).rejects.toThrow(
      /truncate/,
    );
    await expect(fake.verifier.entail({ pairs: [], ...extra })).rejects.toThrow(/truncate/);
  });
});

describe('FakeGateway construction', () => {
  it('refuses two recordings with the same key', () => {
    const recording = generatorRecording('q', { status: 'content', content: '{}' });
    expect(() => gateway([recording, recording])).toThrow(/share a key/);
  });

  it.each<[string, Recording]>([
    [
      'vector per text',
      {
        role: 'embedder',
        pin: pins.embedder,
        request: { texts: ['a', 'b'] },
        reply: { vectors: [[1]] },
      },
    ],
    [
      'score per document',
      {
        role: 'reranker',
        pin: rerankerPin,
        request: { query: 'q', documents: ['d'] },
        reply: { scores: [] },
      },
    ],
    [
      'result per pair',
      {
        role: 'verifier',
        pin: pins.verifier,
        request: { pairs: [] },
        reply: { results: [{ status: 'over-length', inputTokens: 2, maxInputTokens: 1 }] },
      },
    ],
  ])('refuses a recording without one %s', (message, recording) => {
    expect(() => gateway([recording])).toThrow(message);
  });

  it.each([1.5, -0.5])('refuses an entailment score of %d', (entailment) => {
    const scores = { entailment, neutral: 0, contradiction: 0 };
    const pairs = [{ premise: 'p', hypothesis: 'h' }];
    const results = [{ status: 'scored', scores }] as const;
    expect(() =>
      gateway([
        {
          role: 'verifier',
          pin: pins.verifier,
          request: { pairs },
          reply: { results: [...results] },
        },
      ]),
    ).toThrow(/entailment/);
  });
});
