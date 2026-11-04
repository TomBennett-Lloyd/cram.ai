import { RecordingMissError } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonText } from './json-text';
import type { LatencySummary } from './latency';
import type { EvalReport } from './report';
import { scriptedReport } from './run-fixture';
import {
  replayMismatches,
  reportIssueMismatches,
  reportMismatches,
  unreadRunMessage,
} from './tier-one-mismatch';

const Shape = z.strictObject({
  a: z.strictObject({ b: z.number(), c: z.string() }),
  rows: z.array(z.strictObject({ n: z.number() })),
});

const issuesOf = (text: string) => {
  const parsed = parseJsonText(text, Shape);
  return parsed.ok ? [] : parsed.issues;
};

describe('reportIssueMismatches', () => {
  it('names a key the schema requires and the report lacks, at any depth', () => {
    expect(reportIssueMismatches(issuesOf('{"a":{"c":"x"},"rows":[{}]}'))).toEqual([
      { kind: 'report key absent', at: 'a.b' },
      { kind: 'report key absent', at: 'rows[0].n' },
    ]);
  });

  it.each([
    ['a literal', z.literal('x')],
    ['an enum', z.enum(['a', 'b'])],
    ['a union', z.union([z.number(), z.string()])],
    ['a discriminated union', z.discriminatedUnion('s', [z.strictObject({ s: z.literal('a') })])],
  ])('names an absent key whose schema is %s', (_name, schema) => {
    const parsed = parseJsonText('{}', z.strictObject({ k: schema }));
    expect(reportIssueMismatches(parsed.ok ? [] : parsed.issues)).toEqual([
      { kind: 'report key absent', at: 'k' },
    ]);
  });

  it.each([
    ['names a tag the row lacks as an absent key', '{"k":{}}', 'report key absent'],
    ['calls a tag of no known variant invalid', '{"k":{"s":"b"}}', 'report invalid'],
    ['calls a tag of the wrong type invalid', '{"k":{"s":null}}', 'report invalid'],
  ])('%s, at the tag', (_name, text, kind) => {
    const Row = z.discriminatedUnion('s', [z.strictObject({ s: z.literal('a') })]);
    const parsed = parseJsonText(text, z.strictObject({ k: Row }));
    expect(reportIssueMismatches(parsed.ok ? [] : parsed.issues)).toMatchObject([
      { kind, at: 'k.s' },
    ]);
  });

  it('calls a plain union of no matching member invalid', () => {
    const parsed = parseJsonText(
      '{"k":true}',
      z.strictObject({ k: z.union([z.number(), z.string()]) }),
    );
    expect(reportIssueMismatches(parsed.ok ? [] : parsed.issues)).toMatchObject([
      { kind: 'report invalid', at: 'k' },
    ]);
  });

  it('names a top-level key the report lacks by its bare name', () => {
    expect(reportIssueMismatches(issuesOf('{"a":{"b":1,"c":"x"}}'))).toEqual([
      { kind: 'report key absent', at: 'rows' },
    ]);
  });

  it('names each key the report holds and the schema has retired', () => {
    expect(reportIssueMismatches(issuesOf('{"a":{"b":1,"c":"x","d":0,"e":0},"rows":[]}'))).toEqual([
      { kind: 'report key retired', at: 'a.d' },
      { kind: 'report key retired', at: 'a.e' },
    ]);
  });

  it.each([
    ['a value of the wrong type', '{"a":{"b":"1","c":"x"},"rows":[]}', 'a.b'],
    ['a null where an object belongs', '{"a":null,"rows":[]}', 'a'],
  ])('calls %s invalid, never an absent key', (_name, text, at) => {
    expect(reportIssueMismatches(issuesOf(text))).toEqual([
      { kind: 'report invalid', at, message: expect.any(String) as string },
    ]);
  });

  it('calls an issue of any other code invalid', () => {
    const Positive = z.strictObject({ n: z.number().positive() });
    const parsed = parseJsonText('{"n":-1}', Positive);
    expect(reportIssueMismatches(parsed.ok ? [] : parsed.issues)).toEqual([
      { kind: 'report invalid', at: 'n', message: expect.any(String) as string },
    ]);
  });
});

describe('reportMismatches', () => {
  it('finds none between equal reports', () => {
    expect(
      reportMismatches({ a: { b: [1, 'x', null, true] } }, { a: { b: [1, 'x', null, true] } }),
    ).toEqual([]);
  });

  it('names each leaf that moved, with both values', () => {
    expect(
      reportMismatches({ a: { b: 1, c: 2 }, d: [3, 4] }, { a: { b: 1, c: 5 }, d: [3, 6] }),
    ).toEqual([
      { kind: 'value moved', at: 'a.c', committed: 2, replayed: 5 },
      { kind: 'value moved', at: 'd[1]', committed: 4, replayed: 6 },
    ]);
  });

  it('names a key or an element only one side holds', () => {
    expect(reportMismatches({ a: 1, r: [1] }, { b: 2, r: [1, 2] })).toEqual([
      { kind: 'value moved', at: 'a', committed: 1, replayed: undefined },
      { kind: 'value moved', at: 'r[1]', committed: undefined, replayed: 2 },
      { kind: 'value moved', at: 'b', committed: undefined, replayed: 2 },
    ]);
  });

  it.each([
    ['the replay', [], [undefined]],
    ['the committed report', [undefined], []],
  ])('names an undefined element only %s holds, as toEqual counts length', (_name, c, r) => {
    expect(reportMismatches({ r: c }, { r: r })).toEqual([
      { kind: 'value moved', at: 'r[0]', committed: undefined, replayed: undefined },
    ]);
  });

  it('reads an undefined value as an absent key, as toEqual does', () => {
    expect(reportMismatches({ a: 1 }, { a: 1, b: undefined })).toEqual([]);
  });

  it.each([
    ['an array and an object with the same keys', [1], { 0: 1 }],
    ['an object and null', {}, null],
    ['zero and negative zero', 0, -0],
    ['a number and its string', 1, '1'],
  ])('tells %s apart', (_name, committed, replayed) => {
    expect(reportMismatches({ x: committed }, { x: replayed })).toEqual([
      { kind: 'value moved', at: 'x', committed, replayed },
    ]);
  });

  it('names the root when a whole value moved', () => {
    expect(reportMismatches(1, 2)).toEqual([
      { kind: 'value moved', at: '', committed: 1, replayed: 2 },
    ]);
  });
});

const measured = (medianMs: number): LatencySummary => ({
  status: 'measured',
  samples: 2,
  medianMs,
  maxMs: medianMs,
});

const withAskLatency = (report: EvalReport, medianMs: number): EvalReport => ({
  ...report,
  latency: { ...report.latency, ask: measured(medianMs) },
});

describe('replayMismatches', () => {
  it('finds none when the replay returns the committed report, timed differently', async () => {
    const report = await scriptedReport('abc1234');
    const replay = Promise.resolve(withAskLatency(report, 9));
    expect(await replayMismatches(withAskLatency(report, 1), replay)).toEqual([]);
  });

  it('names a value the replay moved', async () => {
    const report = await scriptedReport('abc1234');
    const replay = Promise.resolve({ ...report, retrievalK: report.retrievalK + 1 });
    expect(await replayMismatches(report, replay)).toEqual([
      {
        kind: 'value moved',
        at: 'retrievalK',
        committed: report.retrievalK,
        replayed: report.retrievalK + 1,
      },
    ]);
  });

  it('names a recording miss by the role that missed', async () => {
    const report = await scriptedReport('abc1234');
    const replay = Promise.reject(new RecordingMissError('verifier', 'key'));
    expect(await replayMismatches(report, replay)).toEqual([
      { kind: 'recording miss', role: 'verifier' },
    ]);
  });

  it('rethrows any other failure', async () => {
    const report = await scriptedReport('abc1234');
    const failure = new Error('disk');
    await expect(replayMismatches(report, Promise.reject(failure))).rejects.toBe(failure);
  });
});

describe('unreadRunMessage', () => {
  it('puts the report mismatches ahead of the message', () => {
    const issues = issuesOf('{"a":{"c":"x"},"rows":[]}');
    expect(
      unreadRunMessage({
        status: 'invalid',
        where: 'reports/a.json',
        message: 'zod',
        reportIssues: issues,
      }),
    ).toBe('reports/a.json: [{"kind":"report key absent","at":"a.b"}]\nzod');
  });

  it('is the bare message when the report has no issues', () => {
    expect(
      unreadRunMessage({
        status: 'invalid',
        where: 'recordings',
        message: 'not found',
        reportIssues: [],
      }),
    ).toBe('recordings: not found');
  });
});
