import { describe, expect, it } from 'vitest';
import { UploadProgress } from './ingest-status';

describe('UploadProgress', () => {
  it('reports image-only pages by slide number, counted from 1', () => {
    const indexed = { state: 'indexed', slideCount: 2 };
    expect(UploadProgress.safeParse({ ...indexed, imageOnly: [2] }).success).toBe(true);
    expect(UploadProgress.safeParse({ ...indexed, imageOnly: [0] }).success).toBe(false);
  });

  it('names at least one slide, and the limit, of an over-length deck', () => {
    const over = { state: 'over-length', maxInputTokens: 512 };
    expect(UploadProgress.safeParse({ ...over, slides: [3] }).success).toBe(true);
    expect(UploadProgress.safeParse({ ...over, slides: [] }).success).toBe(false);
    expect(UploadProgress.safeParse({ ...over, slides: [3], maxInputTokens: 0 }).success).toBe(
      false,
    );
  });

  it('refuses a state that is not an ingest stage', () => {
    expect(UploadProgress.safeParse({ state: 'queued' }).success).toBe(true);
    expect(UploadProgress.safeParse({ state: 'done' }).success).toBe(false);
  });
});
