import type { Pooling } from '../../pin';

const rowsOf = (hidden: Float32Array, tokens: number, width: number): Float32Array[] =>
  Array.from({ length: tokens }, (_, token) => hidden.subarray(token * width, (token + 1) * width));

const l2Normalised = (vector: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> => {
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((value) => value / norm);
};

/**
 * One L2-normalised vector per input, as the admitted embedders' reference pipelines produce
 * (`docs/adr/0003-model-roles-and-backends.md` § Decision (g)); normalised, a sum is the mean.
 */
export const pooledVector = (
  hidden: Float32Array,
  tokens: number,
  width: number,
  pooling: Pooling,
): Float32Array<ArrayBuffer> => {
  const rows = rowsOf(hidden, pooling === 'cls' ? 1 : tokens, width);
  const pooled = Float32Array.from({ length: width }, (_, i) =>
    rows.reduce((sum, row) => sum + (row[i] ?? 0), 0),
  );
  return l2Normalised(pooled);
};
