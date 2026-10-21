import { type ChatRequest, OutputName } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LENGTH_RERANKER, ScriptedGateway } from './scripted-gateway-fixture';
import { TimedGateway } from './timed-gateway';

const request: ChatRequest<unknown> = {
  messages: [{ role: 'user', content: 'hi' }],
  output: { name: OutputName.parse('any'), schema: z.unknown() },
};

const steppingClock = (step: number) => {
  let now = 0;
  return () => (now += step);
};

describe('TimedGateway', () => {
  it('keeps one duration per call, under the role that served it', async () => {
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '1' }));
    const gateway = new TimedGateway(inner, steppingClock(5));
    await gateway.generator.chat(request);
    await gateway.generator.chat(request);
    await gateway.embedder.embed({ texts: ['a'] });
    await gateway.verifier.entail({ pairs: [] });
    expect(gateway.durations('generator')).toEqual([5, 5]);
    expect(gateway.durations('embedder')).toEqual([5]);
    expect(gateway.durations('verifier')).toEqual([5]);
    expect(gateway.durations('reranker')).toEqual([]);
  });

  it('reports the sampling its inner generator reports', () => {
    const reseeded = { temperature: 0.5, seed: 7 };
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '1' }), null, reseeded);
    expect(new TimedGateway(inner, steppingClock(1)).generator.sampling).toEqual(reseeded);
  });

  it('returns what the inner gateway returned', async () => {
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '"x"' }));
    await expect(
      new TimedGateway(inner, steppingClock(1)).generator.chat(request),
    ).resolves.toEqual({ status: 'completed', value: 'x' });
  });

  it('times a configured reranker', async () => {
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '1' }), LENGTH_RERANKER);
    const gateway = new TimedGateway(inner, steppingClock(3));
    await expect(gateway.reranker?.rerank({ query: 'q', documents: ['ab'] })).resolves.toEqual([
      { status: 'scored', score: 2 },
    ]);
    expect(gateway.durations('reranker')).toEqual([3]);
  });

  it('has no reranker when the inner gateway has none', () => {
    const inner = new ScriptedGateway(() => ({ status: 'content', content: '1' }));
    expect(new TimedGateway(inner, steppingClock(1)).reranker).toBeNull();
  });
});
