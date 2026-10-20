import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntailmentResult } from '../../encoder-requests';
import { VerifierPin } from '../../pin';
import {
  classifierGraph,
  type EncoderFixture,
  fixturePinFields,
  type Graph,
  loaded,
  rows,
  segmentCounter,
  SNAPSHOT_PATHS,
  VOCAB,
  writeEncoderFixture,
} from './encoder-fixture';
import { loadOnnxVerifier } from './onnx-verifier';

let parent = '';
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'cram-onnx-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

const verifier = async (fixture: EncoderFixture, mismatched?: string) => {
  const written = await writeEncoderFixture(parent, fixture);
  const pin = VerifierPin.parse({
    role: 'verifier',
    ...fixturePinFields(written.files, mismatched),
  });
  return loadOnnxVerifier({ pin, directory: written.directory });
};

const expectClose = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 6);
  });
};

/** `[entailment, neutral, contradiction]`. */
const scoresOf = (result: EntailmentResult | undefined): number[] => {
  if (result?.status !== 'scored') throw new Error(`not scored: ${JSON.stringify(result)}`);
  const { entailment, neutral, contradiction } = result.scores;
  return [entailment, neutral, contradiction];
};

/** The softmax of `[0, winner, 0]`: the winner's probability, then each loser's. */
const softmaxAt = (winner: number): readonly [number, number] => [
  Math.exp(winner) / (Math.exp(winner) + 2),
  1 / (Math.exp(winner) + 2),
];

/** The provisional verifier's label order (`docs/adr/0003-model-roles-and-backends.md` § Decision (k), A7). */
const A7 = { 0: 'contradiction', 1: 'entailment', 2: 'neutral' };

const rankThreeLogits: Graph = {
  ...segmentCounter,
  nodes: [
    ...segmentCounter.nodes.map((n) => (n.output === 'logits' ? { ...n, output: 'flat' } : n)),
    { op: 'Unsqueeze', inputs: ['flat'], output: 'logits', attributes: { axes: [2] } },
  ],
  output: ['logits', ['batch', 3, 1]],
};

describe('loadOnnxVerifier', () => {
  it('feeds the premise as the first segment and reads label order from config.json', async () => {
    const encoder = loaded(await verifier({ graph: segmentCounter, id2label: A7 }));
    const [forward, swapped] = await encoder.entail({
      pairs: [
        { premise: 'alpha', hypothesis: 'beta gamma' },
        { premise: 'beta gamma', hypothesis: 'alpha' },
      ],
    });
    const [won3, lost3] = softmaxAt(3);
    const [won2, lost2] = softmaxAt(2);
    expectClose(scoresOf(forward), [won3, lost3, lost3]);
    expectClose(scoresOf(swapped), [won2, lost2, lost2]);
  });

  it('applies the pair template to an empty hypothesis, as Hugging Face tokenizers encodes a pair', async () => {
    const encoder = loaded(await verifier({ graph: segmentCounter, id2label: A7 }));
    const [result] = await encoder.entail({ pairs: [{ premise: 'alpha', hypothesis: '' }] });
    const [won, lost] = softmaxAt(1);
    expectClose(scoresOf(result), [won, lost, lost]);
  });

  it('moves a score with its label when id2label is permuted', async () => {
    const id2label = { 0: 'entailment', 1: 'contradiction', 2: 'neutral' };
    const encoder = loaded(await verifier({ graph: segmentCounter, id2label }));
    const [result] = await encoder.entail({
      pairs: [{ premise: 'alpha', hypothesis: 'beta gamma' }],
    });
    const [won, lost] = softmaxAt(3);
    expectClose(scoresOf(result), [lost, lost, won]);
  });

  it('runs a model that declares no token_type_ids', async () => {
    const graph = classifierGraph(rows((id) => [0, id === VOCAB.indexOf('alpha') ? 1 : 0, 0]));
    const encoder = loaded(await verifier({ graph, id2label: A7 }));
    const [result] = await encoder.entail({ pairs: [{ premise: 'alpha', hypothesis: 'alpha' }] });
    const [won, lost] = softmaxAt(2);
    expectClose(scoresOf(result), [won, lost, lost]);
  });

  it('reports a pair over model_max_length and scores one at it', async () => {
    const encoder = loaded(await verifier({ graph: segmentCounter, id2label: A7, maxLength: 6 }));
    const [at, over] = await encoder.entail({
      pairs: [
        { premise: 'alpha', hypothesis: 'beta gamma' },
        { premise: 'alpha beta', hypothesis: 'beta gamma' },
      ],
    });
    expect(at).toMatchObject({ status: 'scored' });
    expect(over).toEqual({ status: 'over-length', inputTokens: 7, maxInputTokens: 6 });
  });

  it.each<[string, EncoderFixture, string]>([
    [
      'a missing config.json',
      { graph: segmentCounter, files: { 'config.json': null } },
      'unreadable-file',
    ],
    [
      'a generic id2label',
      { graph: segmentCounter, id2label: { 0: 'LABEL_0' } },
      'invalid-artefact',
    ],
    ['no id2label', { graph: segmentCounter, files: { 'config.json': '{}' } }, 'invalid-artefact'],
    [
      'a two-class head',
      { graph: classifierGraph(rows(() => [0, 0])), id2label: A7 },
      'invalid-artefact',
    ],
    ['logits that are not rank two', { graph: rankThreeLogits, id2label: A7 }, 'invalid-artefact'],
    [
      'a model_max_length below the pair probe',
      { graph: segmentCounter, id2label: A7, maxLength: 2 },
      'invalid-artefact',
    ],
  ])('refuses %s as %s', async (_, fixture, reason) => {
    expect(await verifier(fixture)).toMatchObject({
      status: 'load-failed',
      role: 'verifier',
      reason,
    });
  });

  it('loads when model_max_length equals the pair probe length', async () => {
    const fixture = { graph: segmentCounter, id2label: A7, maxLength: 3 };
    expect(await verifier(fixture)).toMatchObject({ status: 'loaded' });
  });

  it.each(SNAPSHOT_PATHS)('refuses a %s whose digest is not the manifest’s', async (file) => {
    const load = await verifier({ graph: segmentCounter, id2label: A7 }, file);
    expect(load).toMatchObject({ status: 'load-failed', reason: 'digest-mismatch' });
  });

  it('checks every digest before reading config.json', async () => {
    const fixture = { graph: segmentCounter, files: { 'config.json': '{}' } };
    expect(await verifier(fixture, 'tokenizer.json')).toMatchObject({ reason: 'digest-mismatch' });
  });
});
