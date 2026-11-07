import { describe, expect, it } from 'vitest';
import { FollowUpItem } from './follow-up';

const ITEM = {
  turns: [{ question: 'How many eyes does a bee have?', answer: null }],
  question: 'And their colour vision?',
  standalone: 'Which colours can foragers see best?',
  expectedCitations: [{ lectureId: 'l1', slideNo: 1 }],
};

describe('FollowUpItem', () => {
  it('accepts an earlier turn the slides did not cover', () => {
    expect(FollowUpItem.parse(ITEM).turns).toEqual([ITEM.turns[0]]);
  });

  it('refuses a follow-up with no earlier turn, which is not a follow-up', () => {
    expect(FollowUpItem.safeParse({ ...ITEM, turns: [] }).success).toBe(false);
  });

  it('refuses a follow-up naming no expected slide, which no retrieval can be judged on', () => {
    expect(FollowUpItem.safeParse({ ...ITEM, expectedCitations: [] }).success).toBe(false);
  });
});
