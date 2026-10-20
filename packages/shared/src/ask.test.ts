import { describe, expect, it } from 'vitest';
import { AskReply, AskRequest } from './ask';

const unit = { text: 'Worker bees are male.', citations: [], kind: 'answer-sentence' };

describe('AskRequest', () => {
  it('refuses a blank question', () => {
    expect(AskRequest.safeParse({ question: ' \n' }).success).toBe(false);
    expect(AskRequest.safeParse({ question: 'Who are the workers?' }).success).toBe(true);
  });
});

describe('AskReply', () => {
  it('refuses a grounded reply that shows no unit', () => {
    const reply = { status: 'grounded', withheld: [], slides: [] };
    expect(AskReply.safeParse({ ...reply, shown: [] }).success).toBe(false);
    expect(AskReply.safeParse({ ...reply, shown: [unit] }).success).toBe(true);
  });

  it('refuses a model failure carrying the model’s own text', () => {
    expect(AskReply.safeParse({ status: 'model-failed' }).success).toBe(true);
    expect(
      AskReply.safeParse({ status: 'model-failed', content: 'Workers are female.' }).success,
    ).toBe(false);
  });
});
