import {
  type ChatRequest,
  FakeGateway,
  OutputName,
  PROVISIONAL_DEFAULT_PINS,
  RecordingMissError,
} from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type RecordableGateway, RecordingGateway } from './recording-gateway';
import {
  LENGTH_RERANKER,
  NEUTRAL,
  RERANKER_PIN,
  SAMPLING,
  ScriptedGateway,
} from './scripted-gateway-fixture';

const Answer = z.strictObject({ text: z.string() });
const ask = (content: string): ChatRequest<z.infer<typeof Answer>> => ({
  messages: [{ role: 'user', content }],
  output: { name: OutputName.parse('answer'), schema: Answer },
});

const echo = () =>
  new ScriptedGateway((wire) => ({
    status: 'content',
    content: JSON.stringify({ text: wire.messages[0].content }),
  }));

const replayOf = (gateway: RecordingGateway): FakeGateway => {
  const result = gateway.recordings();
  if (result.status !== 'recorded') throw new Error('expected recordings');
  return new FakeGateway({
    pins: PROVISIONAL_DEFAULT_PINS,
    sampling: SAMPLING,
    recordings: result.recordings,
  });
};

describe('RecordingGateway', () => {
  it('forwards each role and hands back what the inner gateway returned', async () => {
    const gateway = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    await expect(gateway.generator.chat(ask('hi'))).resolves.toEqual({
      status: 'completed',
      value: { text: 'hi' },
    });
    await expect(
      gateway.verifier.entail({ pairs: [{ premise: 'a', hypothesis: 'b' }] }),
    ).resolves.toEqual([NEUTRAL]);
    const [embedded] = await gateway.embedder.embed({ texts: ['ab'] });
    expect(embedded?.status === 'embedded' ? embedded.vector : []).toHaveLength(26);
    expect(gateway.reranker).toBeNull();
  });

  it('records calls that FakeGateway replays to the same results', async () => {
    const recorder = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    const chat = await recorder.generator.chat(ask('hi'));
    const pairs = [{ premise: 'cells are square', hypothesis: 'cells are square' }];
    const entail = await recorder.verifier.entail({ pairs });
    const embed = await recorder.embedder.embed({ texts: ['comb', 'bee'] });
    const replay = replayOf(recorder);
    await expect(replay.generator.chat(ask('hi'))).resolves.toEqual(chat);
    await expect(replay.verifier.entail({ pairs })).resolves.toEqual(entail);
    await expect(replay.embedder.embed({ texts: ['comb', 'bee'] })).resolves.toEqual(embed);
  });

  it('keys by the full request, so a different request misses on replay', async () => {
    const recorder = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    await recorder.generator.chat(ask('hi'));
    await expect(replayOf(recorder).generator.chat(ask('hi!'))).rejects.toBeInstanceOf(
      RecordingMissError,
    );
  });

  it('keys a generator call by sampling too', async () => {
    const recorder = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    await recorder.generator.chat(ask('hi'));
    const result = recorder.recordings();
    if (result.status !== 'recorded') throw new Error('expected recordings');
    const reseeded = new FakeGateway({
      pins: PROVISIONAL_DEFAULT_PINS,
      sampling: { ...SAMPLING, seed: 1 },
      recordings: result.recordings,
    });
    await expect(reseeded.generator.chat(ask('hi'))).rejects.toBeInstanceOf(RecordingMissError);
  });

  it('records an identical call once', async () => {
    const recorder = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    await recorder.generator.chat(ask('hi'));
    await recorder.generator.chat(ask('hi'));
    await recorder.embedder.embed({ texts: ['x'] });
    await recorder.embedder.embed({ texts: ['x'] });
    expect(recorder.recordings()).toMatchObject({ status: 'recorded' });
    const result = recorder.recordings();
    expect(result.status === 'recorded' ? result.recordings : []).toHaveLength(2);
  });

  it('records two calls differing only in key order once, as FakeGateway keys them', async () => {
    const recorder = new RecordingGateway({ inner: echo(), sampling: SAMPLING });
    const asked = (schema: typeof Answer): ChatRequest<z.infer<typeof Answer>> => ({
      ...ask('hi'),
      output: { name: OutputName.parse('answer'), schema },
    });
    await recorder.generator.chat(asked(Answer.meta({ x: 1, y: 2 })));
    await recorder.generator.chat(asked(Answer.meta({ y: 2, x: 1 })));
    expect(() => replayOf(recorder)).not.toThrow();
    const result = recorder.recordings();
    expect(result.status === 'recorded' ? result.recordings : []).toHaveLength(1);
  });

  it('reports the same call answered two ways as nondeterministic', async () => {
    let calls = 0;
    const drifting = new ScriptedGateway(() => {
      calls += 1;
      return { status: 'content', content: JSON.stringify({ text: String(calls) }) };
    });
    const recorder = new RecordingGateway({ inner: drifting, sampling: SAMPLING });
    await recorder.generator.chat(ask('hi'));
    await recorder.generator.chat(ask('hi'));
    expect(recorder.recordings()).toMatchObject({
      status: 'nondeterministic',
      first: { role: 'generator', reply: { content: '{"text":"1"}' } },
      second: { role: 'generator', reply: { content: '{"text":"2"}' } },
    });
  });

  it('keeps the first conflict when the call drifts again', async () => {
    let calls = 0;
    const drifting = new ScriptedGateway(() => {
      calls += 1;
      return { status: 'content', content: JSON.stringify({ text: String(calls) }) };
    });
    const recorder = new RecordingGateway({ inner: drifting, sampling: SAMPLING });
    for (let call = 0; call < 3; call += 1) await recorder.generator.chat(ask('hi'));
    expect(recorder.recordings()).toMatchObject({
      first: { reply: { content: '{"text":"1"}' } },
      second: { reply: { content: '{"text":"2"}' } },
    });
  });

  it('records the backend’s reply, so an invalid output replays as invalid', async () => {
    const garbled = new ScriptedGateway(() => ({ status: 'content', content: 'not json' }));
    const recorder = new RecordingGateway({ inner: garbled, sampling: SAMPLING });
    const live = await recorder.generator.chat(ask('hi'));
    expect(live).toMatchObject({ status: 'invalid-output', content: 'not json' });
    await expect(replayOf(recorder).generator.chat(ask('hi'))).resolves.toEqual(live);
  });

  it('records and replays an over-length embedding as over-length', async () => {
    const overLength = { status: 'over-length', inputTokens: 600, maxInputTokens: 512 } as const;
    const { generator, verifier } = echo();
    const inner: RecordableGateway = {
      generator,
      verifier,
      reranker: null,
      embedder: {
        pin: PROVISIONAL_DEFAULT_PINS.embedder,
        embed: () => Promise.resolve([overLength]),
      },
    };
    const recorder = new RecordingGateway({ inner, sampling: SAMPLING });
    await recorder.embedder.embed({ texts: ['long'] });
    await expect(replayOf(recorder).embedder.embed({ texts: ['long'] })).resolves.toEqual([
      overLength,
    ]);
  });

  it('records and replays the reranker when one is configured', async () => {
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '1' }), LENGTH_RERANKER);
    const recorder = new RecordingGateway({ inner, sampling: SAMPLING });
    const request = { query: 'q', documents: ['a', 'bbb'] };
    await expect(recorder.reranker?.rerank(request)).resolves.toEqual([
      { status: 'scored', score: 1 },
      { status: 'scored', score: 3 },
    ]);
    const result = recorder.recordings();
    if (result.status !== 'recorded') throw new Error('expected recordings');
    const replay = new FakeGateway({
      pins: { ...PROVISIONAL_DEFAULT_PINS, reranker: RERANKER_PIN },
      sampling: SAMPLING,
      recordings: result.recordings,
    });
    await expect(replay.reranker?.rerank(request)).resolves.toEqual([
      { status: 'scored', score: 1 },
      { status: 'scored', score: 3 },
    ]);
  });
});
