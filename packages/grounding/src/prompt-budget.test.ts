import { PROVISIONAL_GENERATOR_CONTEXT_LENGTH } from '@cram/gateway';
import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  PROMPT_CHARS_PER_TOKEN,
  PROMPT_TOKEN_BUDGET,
  REPLY_TOKEN_RESERVE,
  requestTokens,
} from './prompt-budget';

describe('the prompt budget', () => {
  it('is the generator’s context length less the reply’s reserve', () => {
    expect(PROMPT_TOKEN_BUDGET + REPLY_TOKEN_RESERVE).toBe(PROVISIONAL_GENERATOR_CONTEXT_LENGTH);
    expect(PROMPT_TOKEN_BUDGET).toBeGreaterThan(0);
  });

  it('estimates a part of a token as a whole one, so an estimate never falls short', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    const whole = 'a'.repeat(PROMPT_CHARS_PER_TOKEN * 2);
    expect(estimateTokens(whole)).toBe(2);
    expect(estimateTokens(`${whole}a`)).toBe(3);
  });

  it('estimates a request message by message, the system message included', () => {
    const whole = 'a'.repeat(PROMPT_CHARS_PER_TOKEN * 2);
    expect(
      requestTokens({
        messages: [
          { role: 'system', content: 'a' },
          { role: 'user', content: `${whole}a` },
        ],
      }),
    ).toBe(4);
  });
});
