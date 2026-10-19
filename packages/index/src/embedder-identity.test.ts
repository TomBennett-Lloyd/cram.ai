import { describe, expect, it } from 'vitest';
import { EmbedderIdentity, sameEmbedder } from './embedder-identity';

const embedder = EmbedderIdentity.parse({ model: 'embedder-a', dimension: 4 });

describe('EmbedderIdentity', () => {
  it('refuses a blank model name and a dimension that is not a positive integer', () => {
    expect(EmbedderIdentity.safeParse({ model: ' ', dimension: 4 }).success).toBe(false);
    expect(EmbedderIdentity.safeParse({ model: 'm', dimension: 0 }).success).toBe(false);
    expect(EmbedderIdentity.safeParse({ model: 'm', dimension: 1.5 }).success).toBe(false);
  });
});

describe('sameEmbedder', () => {
  it('holds only when both the model and the dimension match', () => {
    expect(sameEmbedder(embedder, { ...embedder })).toBe(true);
    expect(sameEmbedder(embedder, { ...embedder, model: 'embedder-b' })).toBe(false);
    expect(sameEmbedder(embedder, { ...embedder, dimension: 8 })).toBe(false);
  });
});
