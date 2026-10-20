import { describe, expect, it } from 'vitest';
import { PROVISIONAL_DEFAULT_PINS } from './provisional-pins';
import { type Recording, recordingKey } from './recording';

const pins = PROVISIONAL_DEFAULT_PINS;
const embedding = (texts: string[], vector: number[]): Recording => ({
  role: 'embedder',
  pin: pins.embedder,
  request: { texts },
  reply: { results: texts.map(() => ({ status: 'embedded', vector })) },
});

describe('recordingKey', () => {
  it('is the same for the same call whatever its reply', () => {
    expect(recordingKey(embedding(['a'], [1]))).toBe(recordingKey(embedding(['a'], [2])));
  });

  it('is the same for a live call and its recording', () => {
    expect(recordingKey({ pin: pins.embedder, request: { texts: ['a'] } })).toBe(
      recordingKey(embedding(['a'], [1])),
    );
  });

  it('ignores key order inside the request', () => {
    expect(recordingKey({ pin: pins.verifier, request: { b: 1, a: 2 } })).toBe(
      recordingKey({ pin: pins.verifier, request: { a: 2, b: 1 } }),
    );
  });

  it('differs by request, by pin and by sampling', () => {
    const base = { pin: pins.embedder, request: { texts: ['a'] } };
    const keys = [
      base,
      { ...base, request: { texts: ['b'] } },
      { ...base, pin: pins.verifier },
      { ...base, sampling: { temperature: 0, seed: 0 } },
      { ...base, sampling: { temperature: 0, seed: 1 } },
    ].map(recordingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
