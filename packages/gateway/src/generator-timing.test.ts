import { describe, expect, it } from 'vitest';
import { decodeTokensPerSecond, type GeneratorTiming } from './generator-timing';

const timing = (completionTokens: number, firstTokenMs: number, lastTokenMs: number) =>
  ({
    firstTokenMs,
    lastTokenMs,
    usage: { promptTokens: 30, completionTokens },
  }) satisfies GeneratorTiming;

describe('decodeTokensPerSecond', () => {
  it('divides the tokens after the first by the first-to-last interval', () => {
    expect(decodeTokensPerSecond(timing(11, 100, 600))).toBe(20);
  });

  it('is null when the server reported no usage', () => {
    expect(decodeTokensPerSecond({ ...timing(11, 100, 600), usage: null })).toBeNull();
  });

  it('is null for a single token, which has no decode interval', () => {
    expect(decodeTokensPerSecond(timing(1, 100, 600))).toBeNull();
  });

  it('is null when every token arrived at once', () => {
    expect(decodeTokensPerSecond(timing(11, 100, 100))).toBeNull();
  });
});
