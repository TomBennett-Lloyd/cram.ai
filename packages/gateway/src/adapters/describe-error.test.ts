import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error';

describe('describeError', () => {
  it('names the error class before its message', () => {
    expect(describeError(new TypeError('fetch failed'))).toBe('TypeError: fetch failed');
    expect(describeError(new DOMException('aborted due to timeout', 'TimeoutError'))).toBe(
      'TimeoutError: aborted due to timeout',
    );
  });

  it('keeps the separator when an error has no message', () => {
    expect(describeError(new Error(''))).toBe('Error: ');
  });

  it('stringifies a thrown value that is not an Error', () => {
    expect(describeError('refused')).toBe('refused');
    expect(describeError({ name: 'Fake', message: 'not an Error' })).toBe('[object Object]');
  });
});
