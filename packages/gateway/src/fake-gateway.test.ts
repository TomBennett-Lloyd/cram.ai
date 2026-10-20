import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatWireRequest, type GeneratorReply, OutputName } from './chat';
import { FakeGateway, RecordingMissError } from './fake-gateway';
import { RerankerPin } from './pin';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';
import type { Recording } from './recording';

const pins = PROVISIONAL_DEFAULT_PINS;
const rerankerPin = RerankerPin.parse({ ...pins.verifier, role: 'reranker' });

const sampling = { temperature: 0, seed: 0 };
const Answer = z.object({ text: z.string() });
const answer = OutputName.parse('answer');
const ask = (content: string) => ({
  messages: [{ role: 'user', content }] as const,
  output: { name: answer, schema: Answer },
});
const generatorRecording = (content: string, reply: GeneratorReply): Recording => ({
  role: 'generator',
  pin: pins.generator,
  sampling,
  request: chatWireRequest(ask(content)),
  reply,
});

const gateway = (recordings: readonly Recording[]) =>
  new FakeGateway({ pins, sampling, recordings });

const reversedKeys = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).reverse());

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

  it('replays a truncated reply as invalid output, as the live adapter reports it', async () => {
    const fake = gateway([
      generatorRecording('q', { status: 'truncated', content: '{"text":"a"}' }),
    ]);
    await expect(fake.generator.chat(ask('q'))).resolves.toMatchObject({
      status: 'invalid-output',
      issue: 'cut off at the token limit',
    });
  });

  it('rejects with a miss when the recording was made under other sampling', async () => {
    const recording = generatorRecording('q', { status: 'content', content: '{"text":"a"}' });
    const fake = new FakeGateway({
      pins,
      sampling: { ...sampling, seed: 1 },
      recordings: [recording],
    });
    await expect(fake.generator.chat(ask('q'))).rejects.toBeInstanceOf(RecordingMissError);
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
      output: { name: answer, schema: z.object({ text: z.number() }) },
    };
    await expect(fake.generator.chat(other)).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('rejects with a miss when the recording was made under another pin', async () => {
    const recording = generatorRecording('q', { status: 'content', content: '{"text":"a"}' });
    const fake = new FakeGateway({
      pins: { ...pins, generator: { ...pins.generator, sha256: 'f'.repeat(64) } },
      sampling,
      recordings: [recording],
    });
    await expect(fake.generator.chat(ask('q'))).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('matches a recording whose unparsed members hold keys in another order', async () => {
    const wire = chatWireRequest(ask('q'));
    const reordered: Recording = {
      role: 'generator',
      pin: pins.generator,
      sampling,
      reply: { status: 'content', content: '{"text":"a"}' },
      request: {
        ...wire,
        output: { ...wire.output, jsonSchema: reversedKeys(wire.output.jsonSchema) },
      },
    };
    const fake = new FakeGateway({
      pins: { ...pins, generator: { ...reversedKeys(pins.generator), ...pins.generator } },
      sampling: { seed: 0, temperature: 0 },
      recordings: [reordered],
    });
    await expect(fake.generator.chat(ask('q'))).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('FakeGateway encoders', () => {
  it('replays a Float32Array per embedded text and over-length results', async () => {
    const overLength = { status: 'over-length', inputTokens: 700, maxInputTokens: 512 } as const;
    const fake = gateway([
      {
        role: 'embedder',
        pin: pins.embedder,
        request: { texts: ['a', 'b', 'long'] },
        reply: {
          results: [
            { status: 'embedded', vector: [0.5, 1] },
            { status: 'embedded', vector: [0, -1] },
            overLength,
          ],
        },
      },
    ]);
    await expect(fake.embedder.embed({ texts: ['a', 'b', 'long'] })).resolves.toEqual([
      { status: 'embedded', vector: Float32Array.from([0.5, 1]) },
      { status: 'embedded', vector: Float32Array.from([0, -1]) },
      overLength,
    ]);
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

  it('replays rerank results when a reranker is pinned', async () => {
    const request = { query: 'q', documents: ['d1', 'd2'] };
    const results = [
      { status: 'scored', score: 2 },
      { status: 'over-length', inputTokens: 9, maxInputTokens: 8 },
    ] as const;
    const fake = new FakeGateway({
      pins: { ...pins, reranker: rerankerPin },
      sampling,
      recordings: [
        { role: 'reranker', pin: rerankerPin, request, reply: { results: [...results] } },
      ],
    });
    await expect(fake.reranker?.rerank(request)).resolves.toEqual(results);
  });

  it('rejects a request carrying a field its schema does not have, for every encoder', async () => {
    const fake = new FakeGateway({
      pins: { ...pins, reranker: rerankerPin },
      sampling,
      recordings: [],
    });
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
      'result per text',
      {
        role: 'embedder',
        pin: pins.embedder,
        request: { texts: ['a', 'b'] },
        reply: { results: [{ status: 'embedded', vector: [1] }] },
      },
    ],
    [
      'result per document',
      {
        role: 'reranker',
        pin: rerankerPin,
        request: { query: 'q', documents: ['d'] },
        reply: { results: [] },
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
