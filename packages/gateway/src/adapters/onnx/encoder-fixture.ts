import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EncoderLoad } from './encoder-artefact';

/** Synthetic encoder artefacts for tests: tiny ONNX graphs written as protobuf, and a WordPiece tokenizer. */

const FLOAT = 1;
/** ONNX `TensorProto.DataType` of a 64-bit integer. */
export const INT64 = 7;
const ATTRIBUTE_INT = 2;
const ATTRIBUTE_INTS = 7;

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
};

const tag = (field: number, wireType: 0 | 2): number[] => varint(field * 8 + wireType);
const intField = (field: number, value: number): number[] => [...tag(field, 0), ...varint(value)];
const bytesField = (field: number, bytes: readonly number[]): number[] => [
  ...tag(field, 2),
  ...varint(bytes.length),
  ...bytes,
];
const stringField = (field: number, text: string): number[] =>
  bytesField(field, [...Buffer.from(text, 'utf8')]);

const floatBytes = (values: readonly number[]): number[] => [
  ...Buffer.from(Float32Array.from(values).buffer),
];

type Dim = number | string;

const valueInfo = (name: string, elemType: number, dims: readonly Dim[]): number[] => {
  const shape = dims.flatMap((dim) =>
    bytesField(1, typeof dim === 'number' ? intField(1, dim) : stringField(2, dim)),
  );
  const tensorType = [...intField(1, elemType), ...bytesField(2, shape)];
  return [...stringField(1, name), ...bytesField(2, bytesField(1, tensorType))];
};

const initializer = (name: string, rows: readonly (readonly number[])[]): number[] => [
  ...intField(1, rows.length),
  ...intField(1, rows[0]?.length ?? 0),
  ...intField(2, FLOAT),
  ...stringField(8, name),
  ...bytesField(9, floatBytes(rows.flat())),
];

type Attribute = number | readonly number[];

const attribute = (name: string, value: Attribute): number[] =>
  bytesField(5, [
    ...stringField(1, name),
    ...(typeof value === 'number'
      ? [...intField(3, value), ...intField(20, ATTRIBUTE_INT)]
      : [...value.flatMap((v) => intField(8, v)), ...intField(20, ATTRIBUTE_INTS)]),
  ]);

export interface Node {
  readonly op: string;
  readonly inputs: readonly string[];
  readonly output: string;
  readonly attributes?: Readonly<Record<string, Attribute>>;
}

const node = ({ op, inputs, output, attributes = {} }: Node): number[] => [
  ...inputs.flatMap((input) => stringField(1, input)),
  ...stringField(2, output),
  ...stringField(4, op),
  ...Object.entries(attributes).flatMap(([name, value]) => attribute(name, value)),
];

/** `ReduceSum` over the token axis, dropping it. */
export const SUM_TOKENS = { axes: [1], keepdims: 0 };

export interface Graph {
  readonly nodes: readonly Node[];
  readonly initializers: readonly (readonly [string, readonly (readonly number[])[]])[];
  readonly inputs: readonly string[];
  readonly output: readonly [string, readonly Dim[]];
  /** The output's ONNX element type; float32 unless given. */
  readonly outputType?: number;
}

const modelBytes = (graph: Graph): Uint8Array => {
  const body = [
    ...graph.nodes.flatMap((n) => bytesField(1, node(n))),
    ...stringField(2, 'fixture'),
    ...graph.initializers.flatMap(([name, rows]) => bytesField(5, initializer(name, rows))),
    ...graph.inputs.flatMap((name) => bytesField(11, valueInfo(name, INT64, ['batch', 'seq']))),
    ...bytesField(12, valueInfo(graph.output[0], graph.outputType ?? FLOAT, graph.output[1])),
  ];
  const opset = [...stringField(1, ''), ...intField(2, 11)];
  return Uint8Array.from([...intField(1, 7), ...bytesField(7, body), ...bytesField(8, opset)]);
};

/** The fixture vocabulary; `[CLS]`, `[SEP]` and the words map to the rows of every table below. */
export const VOCAB = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'alpha', 'beta', 'gamma', 'delta'];

/** `last_hidden_state` is the embedding-table row of each token: [1, seq, rowWidth]. */
export const embedderGraph = (table: readonly (readonly number[])[]): Graph => ({
  nodes: [{ op: 'Gather', inputs: ['table', 'input_ids'], output: 'last_hidden_state' }],
  initializers: [['table', table]],
  inputs: ['input_ids', 'attention_mask', 'token_type_ids'],
  output: ['last_hidden_state', ['batch', 'seq', table[0]?.length ?? 0]],
});

/**
 * `logits` sums each token's row, plus its segment's row when `segments` is given: [1, rowWidth].
 * Without `segments` the graph declares no `token_type_ids` input.
 */
export const classifierGraph = (
  table: readonly (readonly number[])[],
  segments?: readonly (readonly number[])[],
): Graph => {
  const gathered = { op: 'Gather', inputs: ['table', 'input_ids'], output: 'rows' };
  const width = table[0]?.length ?? 0;
  const output: Graph['output'] = ['logits', ['batch', width]];
  if (segments === undefined) {
    return {
      nodes: [
        gathered,
        { op: 'ReduceSum', inputs: ['rows'], output: 'logits', attributes: SUM_TOKENS },
      ],
      initializers: [['table', table]],
      inputs: ['input_ids', 'attention_mask'],
      output,
    };
  }
  return {
    nodes: [
      gathered,
      { op: 'Gather', inputs: ['segments', 'token_type_ids'], output: 'segmentRows' },
      { op: 'Add', inputs: ['rows', 'segmentRows'], output: 'sum' },
      { op: 'ReduceSum', inputs: ['sum'], output: 'logits', attributes: SUM_TOKENS },
    ],
    initializers: [
      ['table', table],
      ['segments', segments],
    ],
    inputs: ['input_ids', 'attention_mask', 'token_type_ids'],
    output,
  };
};

const special = (id: string) => ({ SpecialToken: { id, type_id: 0 } });

/** A BERT-style WordPiece `tokenizer.json` over `VOCAB`. */
export const FIXTURE_TOKENIZER = {
  version: '1.0',
  truncation: null,
  padding: null,
  added_tokens: VOCAB.slice(0, 4).map((content, id) => ({
    id,
    content,
    single_word: false,
    lstrip: false,
    rstrip: false,
    normalized: false,
    special: true,
  })),
  normalizer: {
    type: 'BertNormalizer',
    clean_text: true,
    handle_chinese_chars: true,
    strip_accents: null,
    lowercase: true,
  },
  pre_tokenizer: { type: 'BertPreTokenizer' },
  post_processor: {
    type: 'TemplateProcessing',
    single: [special('[CLS]'), { Sequence: { id: 'A', type_id: 0 } }, special('[SEP]')],
    pair: [
      special('[CLS]'),
      { Sequence: { id: 'A', type_id: 0 } },
      special('[SEP]'),
      { Sequence: { id: 'B', type_id: 1 } },
      { SpecialToken: { id: '[SEP]', type_id: 1 } },
    ],
    special_tokens: Object.fromEntries(
      ['[CLS]', '[SEP]'].map((token) => [
        token,
        { id: token, ids: [VOCAB.indexOf(token)], tokens: [token] },
      ]),
    ),
  },
  decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
  model: {
    type: 'WordPiece',
    unk_token: '[UNK]',
    continuing_subword_prefix: '##',
    max_input_chars_per_word: 100,
    vocab: Object.fromEntries(VOCAB.map((token, id) => [token, id])),
  },
};

export const MODEL_FILE = 'onnx/model.onnx';

const SNAPSHOT_FILES = ['model', 'tokenizer.json', 'tokenizer_config.json', 'config.json'] as const;
type SnapshotFile = (typeof SNAPSHOT_FILES)[number];

export interface EncoderFixture {
  readonly graph: Graph;
  readonly maxLength?: unknown;
  readonly id2label?: unknown;
  /** Replaces a file's contents; `null` leaves the file out of the snapshot. */
  readonly files?: Partial<Record<SnapshotFile, string | Uint8Array | null>>;
}

export interface WrittenFixture {
  readonly directory: string;
  readonly sha256: string;
}

/** Writes a snapshot laid out as a Hugging Face repository is, under `parent`, and the model's digest. */
export const writeEncoderFixture = async (
  parent: string,
  fixture: EncoderFixture,
): Promise<WrittenFixture> => {
  const directory = await mkdtemp(join(parent, 'snapshot-'));
  const model = fixture.files?.model ?? modelBytes(fixture.graph);
  const defaults: Record<SnapshotFile, string | Uint8Array> = {
    model,
    'tokenizer.json': JSON.stringify(FIXTURE_TOKENIZER),
    'tokenizer_config.json': JSON.stringify({
      model_max_length: fixture.maxLength ?? 16,
      do_lower_case: true,
    }),
    'config.json': JSON.stringify({ id2label: fixture.id2label ?? {} }),
  };
  await mkdir(join(directory, 'onnx'));
  for (const name of SNAPSHOT_FILES) {
    const contents = fixture.files?.[name];
    if (contents === null) continue;
    await writeFile(
      join(directory, name === 'model' ? MODEL_FILE : name),
      contents ?? defaults[name],
    );
  }
  return { directory, sha256: createHash('sha256').update(model).digest('hex') };
};

/** One table row per `VOCAB` token. */
export const rows = (row: (id: number) => number[]): number[][] => VOCAB.map((_, id) => row(id));

/** The pin fields every fixture role shares, pinned to `sha256`. */
export const fixturePinFields = (sha256: string) => ({
  backend: 'onnxruntime',
  model: 'cram-fixture/tiny-encoder',
  artefact: { repository: 'cram-fixture/tiny-encoder', file: MODEL_FILE },
  sha256,
  licence: 'MIT',
});

export const MISMATCHED_SHA256 = 'f'.repeat(64);

/** Logits count second-segment tokens into position 1 of 3. */
export const segmentCounter = classifierGraph(
  rows(() => [0, 0, 0]),
  [
    [0, 0, 0],
    [0, 1, 0],
  ],
);

export const loaded = <T>(load: EncoderLoad<T>): T => {
  if (load.status !== 'loaded') throw new Error(`${load.reason}: ${load.detail}`);
  return load.encoder;
};
