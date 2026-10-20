import { z } from 'zod';
import type { EntailmentResult } from '../../encoder-requests';

const NLI_LABELS = ['entailment', 'neutral', 'contradiction'] as const;
type NliLabel = (typeof NLI_LABELS)[number];

/** The logit position of each class. */
export type LabelIndex = Readonly<Record<NliLabel, number>>;
type EntailmentScores = Extract<EntailmentResult, { status: 'scored' }>['scores'];

/** The `id2label` member of a model's `config.json`. */
export const ModelLabels = z.looseObject({ id2label: z.record(z.string(), z.string()) });

const INDICES = NLI_LABELS.map((_, position) => String(position));

const positionOf = (id2label: Readonly<Record<string, string>>, label: NliLabel): number | null => {
  const key = INDICES.find((index) => id2label[index]?.toLowerCase() === label);
  return key === undefined ? null : Number(key);
};

/**
 * Which logit is which class, read from the artefact, never hard-coded
 * (`docs/adr/0003-model-roles-and-backends.md` § Decision (k), A7); null unless `id2label`
 * names exactly the three classes, case-insensitively, at indices from zero.
 */
export const labelIndexOf = (id2label: Readonly<Record<string, string>>): LabelIndex | null => {
  if (Object.keys(id2label).length !== INDICES.length) return null;
  const entailment = positionOf(id2label, 'entailment');
  const neutral = positionOf(id2label, 'neutral');
  const contradiction = positionOf(id2label, 'contradiction');
  if (entailment === null || neutral === null || contradiction === null) return null;
  return { entailment, neutral, contradiction };
};

/** Softmax over the three logits, shifted by their maximum so no exponent overflows. */
export const entailmentScores = (logits: Float32Array, index: LabelIndex): EntailmentScores => {
  const max = Math.max(...logits);
  const exponents = Array.from(logits, (logit) => Math.exp(logit - max));
  const total = exponents.reduce((sum, value) => sum + value, 0);
  const probabilities = exponents.map((value) => value / total);
  return {
    entailment: probabilities[index.entailment] ?? 0,
    neutral: probabilities[index.neutral] ?? 0,
    contradiction: probabilities[index.contradiction] ?? 0,
  };
};
