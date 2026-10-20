import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmbeddingResult } from '../../encoder-requests';
import { EmbedderPin, type Pooling } from '../../pin';
import {
  type EncoderFixture,
  embedderGraph,
  fixturePinFields,
  type Graph,
  INT64,
  loaded,
  MISMATCHED_SHA256,
  MODEL_FILE,
  rows,
  SNAPSHOT_PATHS,
  segmentCounter,
  writeEncoderFixture,
} from './encoder-fixture';
import { loadOnnxEmbedder } from './onnx-embedder';

let parent = '';
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'cram-onnx-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

const embedder = async (fixture: EncoderFixture, pooling: Pooling = 'cls', mismatched?: string) => {
  const written = await writeEncoderFixture(parent, fixture);
  const pin = EmbedderPin.parse({
    role: 'embedder',
    ...fixturePinFields(written.files, mismatched, pooling),
  });
  return loadOnnxEmbedder({ pin, directory: written.directory });
};

const unit = (...values: number[]): number[] =>
  values.map((value) => value / Math.hypot(...values));

const expectClose = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 6);
  });
};

const embeddedVector = (result: EmbeddingResult | undefined): number[] => {
  if (result?.status !== 'embedded') throw new Error(`not embedded: ${JSON.stringify(result)}`);
  return [...result.vector];
};

/** Row `id` is `[id, 1]`: `[CLS]` is `[2, 1]`, `alpha` `[4, 1]`, `[SEP]` `[3, 1]`. */
const idRows = embedderGraph(rows((id) => [id, 1]));

const unknownInputGraph: Graph = { ...idRows, inputs: [...idRows.inputs, 'pixel_values'] };
const noInputIdsGraph: Graph = {
  nodes: [{ op: 'Gather', inputs: ['table', 'attention_mask'], output: 'last_hidden_state' }],
  initializers: idRows.initializers,
  inputs: ['attention_mask'],
  output: idRows.output,
};
const rankFourHiddenState: Graph = {
  ...idRows,
  nodes: [
    { op: 'Gather', inputs: ['table', 'input_ids'], output: 'rows' },
    { op: 'Unsqueeze', inputs: ['rows'], output: 'last_hidden_state', attributes: { axes: [3] } },
  ],
  output: ['last_hidden_state', ['batch', 'seq', 2, 1]],
};

const integerHiddenState: Graph = {
  ...idRows,
  nodes: [
    { op: 'Gather', inputs: ['table', 'input_ids'], output: 'rows' },
    { op: 'Cast', inputs: ['rows'], output: 'last_hidden_state', attributes: { to: INT64 } },
  ],
  outputType: INT64,
};
describe('loadOnnxEmbedder', () => {
  it('pools the first token under cls pooling', async () => {
    const results = await loaded(await embedder({ graph: idRows })).embed({ texts: ['alpha'] });
    expectClose(embeddedVector(results[0]), unit(2, 1));
  });

  it('averages every token under mean pooling, one result per text in request order', async () => {
    const encoder = loaded(await embedder({ graph: idRows }, 'mean'));
    const [first, second] = await encoder.embed({ texts: ['alpha', 'beta gamma'] });
    expectClose(embeddedVector(first), unit(3, 1));
    expectClose(embeddedVector(second), unit(4, 1));
  });

  it('reports a text over model_max_length, never truncating it, and embeds one at it', async () => {
    const encoder = loaded(await embedder({ graph: idRows, maxLength: 4 }));
    const [over, at] = await encoder.embed({ texts: ['alpha beta gamma', 'alpha beta'] });
    expect(over).toEqual({ status: 'over-length', inputTokens: 5, maxInputTokens: 4 });
    expect(at).toMatchObject({ status: 'embedded' });
  });

  it('loads when model_max_length equals the probe length', async () => {
    expect(await embedder({ graph: idRows, maxLength: 2 })).toMatchObject({ status: 'loaded' });
  });

  it.each<[string, EncoderFixture, string]>([
    ['a missing model', { graph: idRows, files: { model: null } }, 'unreadable-file'],
    [
      'a missing tokenizer',
      { graph: idRows, files: { 'tokenizer.json': null } },
      'unreadable-file',
    ],
    [
      'a missing tokenizer config',
      { graph: idRows, files: { 'tokenizer_config.json': null } },
      'unreadable-file',
    ],
    [
      'a model that is not ONNX',
      { graph: idRows, files: { model: 'not onnx' } },
      'invalid-artefact',
    ],
    [
      'a tokenizer that is not JSON',
      { graph: idRows, files: { 'tokenizer.json': '{' } },
      'invalid-artefact',
    ],
    [
      'a tokenizer with no model',
      { graph: idRows, files: { 'tokenizer.json': '{}' } },
      'invalid-artefact',
    ],
    ['an unset model_max_length', { graph: idRows, maxLength: 1e30 }, 'invalid-artefact'],
    ['a zero model_max_length', { graph: idRows, maxLength: 0 }, 'invalid-artefact'],
    ['a fractional model_max_length', { graph: idRows, maxLength: 2.5 }, 'invalid-artefact'],
    [
      'no model_max_length',
      { graph: idRows, files: { 'tokenizer_config.json': '{}' } },
      'invalid-artefact',
    ],
    ['a model_max_length below the probe', { graph: idRows, maxLength: 1 }, 'invalid-artefact'],
    ['a model with no last_hidden_state', { graph: segmentCounter }, 'invalid-artefact'],
    ['a model with an input no tokenizer feeds', { graph: unknownInputGraph }, 'invalid-artefact'],
    ['a model with no input_ids', { graph: noInputIdsGraph }, 'invalid-artefact'],
    ['a hidden state that is not rank three', { graph: rankFourHiddenState }, 'invalid-artefact'],
    ['a zero-width hidden state', { graph: embedderGraph(rows(() => [])) }, 'invalid-artefact'],
    ['a hidden state that is not float32', { graph: integerHiddenState }, 'invalid-artefact'],
  ])('refuses %s as %s', async (_, fixture, reason) => {
    expect(await embedder(fixture)).toMatchObject({
      status: 'load-failed',
      role: 'embedder',
      reason,
    });
  });

  it.each(SNAPSHOT_PATHS)(
    'refuses a %s whose digest is not the manifest’s, naming both',
    async (file) => {
      const load = await embedder({ graph: idRows }, 'cls', file);
      if (load.status !== 'load-failed') throw new Error('loaded under a mismatched pin');
      expect(load.reason).toBe('digest-mismatch');
      expect(load.detail).toContain(`${file}: sha256 `);
      expect(load.detail).toContain(`pinned ${MISMATCHED_SHA256}`);
    },
  );

  it('checks every digest before parsing any file', async () => {
    const fixture = { graph: idRows, files: { 'tokenizer_config.json': '{' } };
    expect(await embedder(fixture, 'cls', 'tokenizer.json')).toMatchObject({
      reason: 'digest-mismatch',
    });
    expect(await embedder(fixture, 'cls', MODEL_FILE)).toMatchObject({
      reason: 'digest-mismatch',
    });
  });

  it('throws on a relative directory, which is the caller’s config bug', async () => {
    const files = Object.fromEntries(SNAPSHOT_PATHS.map((file) => [file, MISMATCHED_SHA256]));
    const pin = EmbedderPin.parse({
      role: 'embedder',
      ...fixturePinFields(files, undefined, 'cls'),
    });
    await expect(loadOnnxEmbedder({ pin, directory: 'models' })).rejects.toThrow(/absolute path/);
  });
});
