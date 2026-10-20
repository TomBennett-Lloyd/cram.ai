import { Tokenizer } from '@huggingface/tokenizers';
import { describe, expect, it } from 'vitest';
import { FIXTURE_TOKENIZER } from './encoder-fixture';
import { encodeInput } from './input-encoding';

const tokenizer = (json: object = FIXTURE_TOKENIZER) => new Tokenizer(json, {});

const withoutVocab = (...tokens: string[]) => ({
  ...FIXTURE_TOKENIZER,
  model: {
    ...FIXTURE_TOKENIZER.model,
    vocab: Object.fromEntries(
      Object.entries(FIXTURE_TOKENIZER.model.vocab).filter(([token]) => !tokens.includes(token)),
    ),
  },
});

describe('encodeInput', () => {
  it('encodes one text with special tokens in the first segment', () => {
    expect(encodeInput(tokenizer(), 'alpha')).toEqual({
      ids: [2, 4, 3],
      attentionMask: [1, 1, 1],
      tokenTypeIds: [0, 0, 0],
    });
  });

  it('encodes a pair through the pair template, the pair in the second segment', () => {
    expect(encodeInput(tokenizer(), 'alpha', 'beta')).toEqual({
      ids: [2, 4, 3, 5, 3],
      attentionMask: [1, 1, 1, 1, 1],
      tokenTypeIds: [0, 0, 0, 1, 1],
    });
  });

  it('applies the pair template to an empty pair member', () => {
    expect(encodeInput(tokenizer(), 'alpha', '')).toEqual({
      ids: [2, 4, 3, 3],
      attentionMask: [1, 1, 1, 1],
      tokenTypeIds: [0, 0, 0, 1],
    });
  });

  it('reads a special token outside the model vocabulary from the added tokens', () => {
    expect(encodeInput(tokenizer(withoutVocab('[CLS]', '[SEP]')), 'alpha', '').ids).toEqual([
      2, 4, 3, 3,
    ]);
  });

  it('adds nothing around an empty pair member when the tokenizer has no post-processor', () => {
    expect(
      encodeInput(tokenizer({ ...FIXTURE_TOKENIZER, post_processor: null }), 'alpha', ''),
    ).toEqual({ ids: [4], attentionMask: [1], tokenTypeIds: [0] });
  });

  it('throws when the pair template names a token with no id', () => {
    const json = {
      ...withoutVocab('[SEP]'),
      added_tokens: FIXTURE_TOKENIZER.added_tokens.slice(0, 3),
    };
    expect(() => encodeInput(tokenizer(json), 'alpha', '')).toThrow(/\[SEP\] has no id/);
  });
});
