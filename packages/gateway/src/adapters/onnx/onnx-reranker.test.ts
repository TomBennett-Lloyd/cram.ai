import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RerankerPin } from '../../pin';
import {
  classifierGraph,
  type EncoderFixture,
  FIXTURE_TOKENIZER,
  fixturePinFields,
  loaded,
  rows,
  segmentCounter,
  writeEncoderFixture,
} from './encoder-fixture';
import { loadOnnxReranker } from './onnx-reranker';

let parent = '';
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'cram-onnx-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

const reranker = async (fixture: EncoderFixture) => {
  const written = await writeEncoderFixture(parent, fixture);
  const pin = RerankerPin.parse({ role: 'reranker', ...fixturePinFields(written.sha256) });
  return loadOnnxReranker({ pin, directory: written.directory });
};

describe('loadOnnxReranker', () => {
  /** Row `id` is `[id]`; the second segment adds a hundred per token. */
  const relevance = classifierGraph(
    rows((id) => [id]),
    [[0], [100]],
  );

  it('scores the raw logit with the query as the first segment', async () => {
    const encoder = loaded(await reranker({ graph: relevance }));
    const [result] = await encoder.rerank({ query: 'alpha', documents: ['beta gamma'] });
    expect(result).toEqual({ status: 'scored', score: 2 + 4 + 3 + 105 + 106 + 103 });
  });

  it('applies the pair template to an empty document', async () => {
    const encoder = loaded(await reranker({ graph: relevance }));
    const [result] = await encoder.rerank({ query: 'alpha', documents: [''] });
    expect(result).toEqual({ status: 'scored', score: 2 + 4 + 3 + 103 });
  });

  it('reports a document over model_max_length and scores one at it, in request order', async () => {
    const encoder = loaded(await reranker({ graph: relevance, maxLength: 5 }));
    const results = await encoder.rerank({ query: 'alpha', documents: ['beta gamma', 'beta'] });
    expect(results).toEqual([
      { status: 'over-length', inputTokens: 6, maxInputTokens: 5 },
      { status: 'scored', score: 217 },
    ]);
  });

  it.each<[string, EncoderFixture]>([
    ['a head with more than one logit', { graph: segmentCounter }],
    ['a model_max_length below the pair probe', { graph: relevance, maxLength: 2 }],
    [
      'a tokenizer whose pair template names a token with no id',
      {
        graph: relevance,
        files: {
          'tokenizer.json': JSON.stringify({
            ...FIXTURE_TOKENIZER,
            added_tokens: FIXTURE_TOKENIZER.added_tokens.filter((t) => t.content !== '[SEP]'),
            model: { ...FIXTURE_TOKENIZER.model, vocab: { '[UNK]': 1, alpha: 4 } },
          }),
        },
      },
    ],
  ])('refuses %s', async (_, fixture) => {
    expect(await reranker(fixture)).toMatchObject({
      status: 'load-failed',
      role: 'reranker',
      reason: 'invalid-artefact',
    });
  });

  it('loads when model_max_length equals the pair probe length', async () => {
    expect(await reranker({ graph: relevance, maxLength: 3 })).toMatchObject({ status: 'loaded' });
  });
});
