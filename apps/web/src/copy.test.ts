import { describe, expect, it } from 'vitest';
import { answerUnit } from './api/api-fixture';
import { discardedMessage, withheldMessage } from './copy';

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

describe('discardedMessage', () => {
  const lost = (...discarded: { table: string; rows: number }[]) =>
    discardedMessage(discarded).split(': ')[1];

  it('names each table a student would know in its own words, and counts its rows', () => {
    expect(lost({ table: 'topics', rows: 12 }, { table: 'confirmations', rows: 3 })).toBe(
      '12 topic tags, 3 confirmations of text read from slide pictures.',
    );
    expect(lost({ table: 'topics', rows: 1 }, { table: 'confirmations', rows: 1 })).toBe(
      '1 topic tag, 1 confirmation of text read from a slide picture.',
    );
  });

  it('sums every other table into one count, never naming it', () => {
    expect(lost({ table: 'attempts', rows: 2 }, { table: 'notes', rows: 1 })).toBe(
      '3 other saved items.',
    );
    expect(lost({ table: 'topics', rows: 2 }, { table: 'constructor', rows: 1 })).toBe(
      '2 topic tags, 1 other saved item.',
    );
  });
});
