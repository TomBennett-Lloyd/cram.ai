import { describe, expect, it } from 'vitest';
import { ApiRefusal } from './api-refusal';
import { slide as record } from './slide-record-fixture';

describe('ApiRefusal', () => {
  it('requires the issue on a bad request and the problem on an unavailable course', () => {
    expect(ApiRefusal.safeParse({ status: 'bad-request' }).success).toBe(false);
    expect(ApiRefusal.safeParse({ status: 'bad-request', issue: 'no question' }).success).toBe(
      true,
    );
    expect(ApiRefusal.safeParse({ status: 'course-unavailable' }).success).toBe(false);
    expect(
      ApiRefusal.safeParse({ status: 'course-unavailable', problem: 'newer-schema' }).success,
    ).toBe(true);
    expect(ApiRefusal.safeParse({ status: 'course-unavailable', problem: 'open' }).success).toBe(
      false,
    );
  });

  it('refuses a dismissal of a report other than the file’s by status alone', () => {
    expect(ApiRefusal.safeParse({ status: 'report-changed' }).success).toBe(true);
  });

  it('carries the chunk’s stored list on a tag edit made against another', () => {
    const refusal = { status: 'tags-changed' };
    expect(
      ApiRefusal.safeParse({ ...refusal, tags: [{ tag: 'castes', origin: 'tagger' }] }).success,
    ).toBe(true);
    expect(ApiRefusal.safeParse({ ...refusal, tags: [] }).success).toBe(true);
    expect(ApiRefusal.safeParse(refusal).success).toBe(false);
    expect(ApiRefusal.safeParse({ ...refusal, tags: ['castes'] }).success).toBe(false);
  });

  it('carries the slide as stored on a tag edit made against a chunk text it no longer holds', () => {
    const refusal = { status: 'chunk-changed' };
    const chunk = { chunkNo: 1, textHash: 'b'.repeat(64), lines: [], tags: [] };
    const slide = { sourceId: 'l1/1', record: record(), chunks: [chunk] };
    expect(ApiRefusal.safeParse({ ...refusal, slide }).success).toBe(true);
    expect(ApiRefusal.safeParse(refusal).success).toBe(false);
    expect(ApiRefusal.safeParse({ ...refusal, slide: { ...slide, chunks: [] } }).success).toBe(
      false,
    );
    expect(ApiRefusal.safeParse({ ...refusal, tags: [] }).success).toBe(false);
  });

  it('carries the embedder limit on a question too long to embed', () => {
    const refusal = { status: 'question-over-length' };
    expect(ApiRefusal.safeParse({ ...refusal, maxInputTokens: 512 }).success).toBe(true);
    expect(ApiRefusal.safeParse(refusal).success).toBe(false);
  });
});
