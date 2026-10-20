import { describe, expect, it } from 'vitest';
import { answerUnit } from './api/api-fixture';
import { withheldMessage } from './copy';

const unit = answerUnit('Drones forage.', []);

describe('withheldMessage', () => {
  it('gives each withheld reason, and each partial policy, its own sentence', () => {
    const sentences = [
      withheldMessage({ reason: 'dangling-citation', unit }),
      withheldMessage({ reason: 'unsupported', unit }),
      withheldMessage({ reason: 'partial', policy: 'drop', unit }),
      withheldMessage({ reason: 'partial', policy: 'rewrite-once', unit }),
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(sentences[0]).toMatch(/^It cites no slide, or one of its citations/);
    expect(sentences[3]).toContain('even after one rewrite');
  });
});
