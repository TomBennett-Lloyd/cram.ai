import { describe, expect, it } from 'vitest';
import { AskReply, AskRequest } from './ask';

const explanation = {
  text: 'Worker bees are male.',
  quotes: [],
  sentences: [{ text: 'Worker bees are male.', slides: ['l1/3'], contradicts: [] }],
  sources: ['l1/3'],
};

describe('AskRequest', () => {
  it('refuses a blank question', () => {
    expect(AskRequest.safeParse({ question: ' \n' }).success).toBe(false);
    expect(AskRequest.safeParse({ question: 'Who are the workers?' }).success).toBe(true);
  });
});

describe('AskReply', () => {
  it('refuses a grounded reply with no explanation, or with no left-out list', () => {
    const reply = { status: 'grounded', withheld: [], slides: [], leftOut: [] };
    expect(AskReply.safeParse(reply).success).toBe(false);
    expect(AskReply.safeParse({ ...reply, explanation }).success).toBe(true);
    const unlisted = { status: 'grounded', explanation, withheld: [], slides: [] };
    expect(AskReply.safeParse(unlisted).success).toBe(false);
  });

  it('refuses a withheld unit where a withheld sentence belongs', () => {
    const reply = { status: 'not-covered', slides: [], leftOut: [] };
    const unit = { text: 'Worker bees are male.', citations: [], kind: 'lecture-summary' };
    expect(
      AskReply.safeParse({ ...reply, withheld: [{ reason: 'unsupported', unit }] }).success,
    ).toBe(false);
    expect(
      AskReply.safeParse({ ...reply, withheld: [{ reason: 'unsupported', text: unit.text }] })
        .success,
    ).toBe(true);
  });

  it('carries the searched text only as non-blank text', () => {
    const reply = { status: 'not-covered', withheld: [], slides: [], leftOut: [] };
    expect(AskReply.safeParse(reply).success).toBe(true);
    expect(AskReply.safeParse({ ...reply, searched: 'Who are the workers?' }).success).toBe(true);
    expect(AskReply.safeParse({ ...reply, searched: ' ' }).success).toBe(false);
    const grounded = { status: 'grounded', explanation, withheld: [], slides: [], leftOut: [] };
    expect(AskReply.safeParse({ ...grounded, searched: 'Who are the workers?' }).success).toBe(
      true,
    );
    expect(AskReply.safeParse({ ...grounded, searched: '' }).success).toBe(false);
  });

  it('refuses a model failure carrying the model’s own text', () => {
    expect(AskReply.safeParse({ status: 'model-failed' }).success).toBe(true);
    expect(
      AskReply.safeParse({ status: 'model-failed', content: 'Workers are female.' }).success,
    ).toBe(false);
  });
});
