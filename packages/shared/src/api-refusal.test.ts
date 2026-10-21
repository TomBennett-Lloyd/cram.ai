import { describe, expect, it } from 'vitest';
import { ApiRefusal } from './api-refusal';

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

  it('carries the embedder limit on a question too long to embed', () => {
    const refusal = { status: 'question-over-length' };
    expect(ApiRefusal.safeParse({ ...refusal, maxInputTokens: 512 }).success).toBe(true);
    expect(ApiRefusal.safeParse(refusal).success).toBe(false);
  });
});
