import type { Tokenizer } from '@huggingface/tokenizers';

export interface InputEncoding {
  readonly ids: readonly number[];
  readonly attentionMask: readonly number[];
  readonly tokenTypeIds: readonly number[];
}

const zeros = (length: number): number[] => new Array<number>(length).fill(0);

/**
 * `Tokenizer.encode` reads an empty pair member as no pair (`text_pair || null`), where the
 * reference tokenizer applies the pair template to an empty second segment; this applies it.
 */
const encodeEmptyPair = (tokenizer: Tokenizer, text: string): InputEncoding => {
  const first = tokenizer.tokenize(text);
  const processed = tokenizer.post_processor?.(first, [], true) ?? { tokens: first };
  const ids = processed.tokens.map((token) => {
    const id = tokenizer.token_to_id(token);
    if (id === undefined) throw new Error(`encodeEmptyPair: ${token} has no id`);
    return id;
  });
  return {
    ids,
    attentionMask: ids.map(() => 1),
    tokenTypeIds: processed.token_type_ids ?? zeros(ids.length),
  };
};

/** One text, or a pair through the tokenizer's pair template, with special tokens and no truncation. */
export const encodeInput = (tokenizer: Tokenizer, text: string, pair?: string): InputEncoding => {
  if (pair === '') return encodeEmptyPair(tokenizer, text);
  const options: Parameters<Tokenizer['encode']>[1] = {
    text_pair: pair ?? null,
    return_token_type_ids: true,
  };
  const encoding = tokenizer.encode(text, options);
  return {
    ids: encoding.ids,
    attentionMask: encoding.attention_mask,
    tokenTypeIds: encoding.token_type_ids ?? zeros(encoding.ids.length),
  };
};
