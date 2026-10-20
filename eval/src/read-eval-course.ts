import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import type { EvalCourse } from './audit';
import { parseDeck, type DeckFile } from './deck';
import { GoldenQuestion } from './golden-question';
import { HandLabel } from './hand-label';
import { parseJsonLines } from './json-text';

/** The `eval/` directory of this checkout. */
export const EVAL_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const DECK_DIR = 'decks/hollowmere';
export const QUESTIONS_FILE = 'questions.jsonl';
export const LABELS_FILE = 'labels/verifier.jsonl';

interface Invalid {
  readonly status: 'invalid';
  readonly where: string;
  readonly message: string;
}

export type EvalCourseRead = { readonly status: 'read'; readonly course: EvalCourse } | Invalid;

type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const isMissing = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'ENOTDIR');

const attempt = <T>(read: () => T): Attempt<T> => {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (isMissing(error)) return { ok: false };
    throw error;
  }
};

const missing = (where: string): Invalid => ({ status: 'invalid', where, message: 'not found' });

type Step<T> = { readonly status: 'ok'; readonly value: T } | Invalid;

const readDeckFiles = (root: string): Step<DeckFile[]> => {
  const names = attempt(() => readdirSync(join(root, DECK_DIR)));
  if (!names.ok) return missing(DECK_DIR);
  const files: DeckFile[] = [];
  for (const name of names.value.filter((n) => n.endsWith('.json'))) {
    const path = `${DECK_DIR}/${name}`;
    const text = attempt(() => readFileSync(join(root, path), 'utf8'));
    if (!text.ok) return missing(path);
    files.push({ name: path, text: text.value });
  }
  return { status: 'ok', value: files };
};

const readJsonLines = <S extends z.ZodType>(
  root: string,
  file: string,
  schema: S,
): Step<readonly z.infer<S>[]> => {
  const text = attempt(() => readFileSync(join(root, file), 'utf8'));
  if (!text.ok) return missing(file);
  const parsed = parseJsonLines(text.value, schema);
  return parsed.status === 'parsed'
    ? { status: 'ok', value: parsed.items }
    : { status: 'invalid', where: `${file}:${String(parsed.line)}`, message: parsed.message };
};

export const readEvalCourse = (root: string = EVAL_ROOT): EvalCourseRead => {
  const files = readDeckFiles(root);
  if (files.status === 'invalid') return files;
  const deck = parseDeck(files.value);
  if (deck.status === 'invalid')
    return { status: 'invalid', where: deck.file, message: deck.message };
  const questions = readJsonLines(root, QUESTIONS_FILE, GoldenQuestion);
  if (questions.status === 'invalid') return questions;
  const labels = readJsonLines(root, LABELS_FILE, HandLabel);
  if (labels.status === 'invalid') return labels;
  return {
    status: 'read',
    course: { deck: deck.deck, questions: questions.value, labels: labels.value },
  };
};
