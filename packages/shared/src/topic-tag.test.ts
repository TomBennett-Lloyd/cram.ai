import { describe, expect, it } from 'vitest';
import { TopicTag } from './topic-tag';

describe('TopicTag', () => {
  it('accepts a trimmed tag, one character or several words long', () => {
    for (const tag of ['a', 'cells', 'cell biology', 'cell\nbiology'])
      expect(TopicTag.safeParse(tag).success, tag).toBe(true);
  });

  it('refuses a blank or untrimmed tag', () => {
    for (const tag of ['', ' ', ' \n\t', ' cells', 'cells ', '\tcells', 'cells\n'])
      expect(TopicTag.safeParse(tag).success, JSON.stringify(tag)).toBe(false);
  });
});
