import { RecordingMissError } from '@cram/gateway';
import type { Role } from '@cram/gateway';
import type { z } from 'zod';
import type { EvalReport } from './report';
import { untimed } from './replay-run';
import type { EvalRunRead } from './run-files';

/** Why tier 1 (`eval/src/committed-run.test.ts`) is red, by kind (#460). */
export type TierOneMismatch =
  | { readonly kind: 'report key absent'; readonly at: string }
  | { readonly kind: 'report key retired'; readonly at: string }
  | { readonly kind: 'report invalid'; readonly at: string; readonly message: string }
  | { readonly kind: 'recording miss'; readonly role: Role }
  | {
      readonly kind: 'value moved';
      readonly at: string;
      readonly committed: unknown;
      readonly replayed: unknown;
    };

const pathText = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (text, key) =>
      typeof key === 'number'
        ? `${text}[${String(key)}]`
        : text === ''
          ? String(key)
          : `${text}.${String(key)}`,
    '',
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parsed JSON holds no `undefined`; a discriminated union's issue carries the row, not the tag. */
const isAbsentKey = (issue: z.core.$ZodIssue): boolean =>
  issue.code === 'invalid_union' && issue.discriminator !== undefined
    ? isRecord(issue.input) && !Object.hasOwn(issue.input, issue.discriminator)
    : issue.input === undefined;

export const reportIssueMismatches = (
  issues: readonly z.core.$ZodIssue[],
): readonly TierOneMismatch[] =>
  issues.flatMap((issue): TierOneMismatch[] => {
    if (issue.code === 'unrecognized_keys')
      return issue.keys.map((key) => ({
        kind: 'report key retired',
        at: pathText([...issue.path, key]),
      }));
    if (isAbsentKey(issue)) return [{ kind: 'report key absent', at: pathText(issue.path) }];
    return [{ kind: 'report invalid', at: pathText(issue.path), message: issue.message }];
  });

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const movedLeaf = (
  path: readonly PropertyKey[],
  committed: unknown,
  replayed: unknown,
): TierOneMismatch => ({ kind: 'value moved', at: pathText(path), committed, replayed });

const moved = (
  path: readonly PropertyKey[],
  committed: unknown,
  replayed: unknown,
): TierOneMismatch[] => {
  if (isList(committed) && isList(replayed)) {
    const length = Math.max(committed.length, replayed.length);
    return Array.from({ length }, (_, index) =>
      index < committed.length && index < replayed.length
        ? moved([...path, index], committed[index], replayed[index])
        : [movedLeaf([...path, index], committed[index], replayed[index])],
    ).flat();
  }
  if (isRecord(committed) && isRecord(replayed)) {
    const keys = new Set([...Object.keys(committed), ...Object.keys(replayed)]);
    return [...keys].flatMap((key) => moved([...path, key], committed[key], replayed[key]));
  }
  return Object.is(committed, replayed) ? [] : [movedLeaf(path, committed, replayed)];
};

export const reportMismatches = (
  committed: unknown,
  replayed: unknown,
): readonly TierOneMismatch[] => moved([], committed, replayed);

export const replayMismatches = async (
  committed: EvalReport,
  replay: Promise<EvalReport>,
): Promise<readonly TierOneMismatch[]> => {
  try {
    return reportMismatches(untimed(committed), untimed(await replay));
  } catch (error) {
    if (error instanceof RecordingMissError) return [{ kind: 'recording miss', role: error.role }];
    throw error;
  }
};

export const unreadRunMessage = (read: Extract<EvalRunRead, { status: 'invalid' }>): string => {
  const kinds = reportIssueMismatches(read.reportIssues);
  const head = `${read.where}: `;
  return kinds.length === 0
    ? head + read.message
    : `${head}${JSON.stringify(kinds)}\n${read.message}`;
};
