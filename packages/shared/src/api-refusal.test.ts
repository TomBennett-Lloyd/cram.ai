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
  });
});
