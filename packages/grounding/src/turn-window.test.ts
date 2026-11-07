import type { AskTurn } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { PROMPT_TOKEN_BUDGET, REPLY_TOKEN_RESERVE } from './prompt-budget';
import { ASK_TURN_WINDOW, carriedTurns } from './turn-window';

/**
 * The pinned embedder's input cap, a question's worst case: `model_max_length` in its snapshot,
 * read by `jq .model_max_length "$CRAM_MODELS_DIR/BAAI/bge-small-en-v1.5/tokenizer_config.json"`.
 */
const EMBED_INPUT_CAP = 512;

const turns = (count: number): AskTurn[] =>
  Array.from({ length: count }, (_, at) => ({
    question: `Question ${String(at)}?`,
    answer: at % 2 === 0 ? `Answer ${String(at)}.` : null,
  }));

describe('carriedTurns', () => {
  it('carries the newest ASK_TURN_WINDOW turns in order and counts the rest as dropped', () => {
    const thread = turns(ASK_TURN_WINDOW + 2);
    expect(carriedTurns(thread)).toEqual({ carried: thread.slice(2), dropped: 2 });
  });

  it('drops nothing from an empty thread or one the window holds', () => {
    expect(carriedTurns([])).toEqual({ carried: [], dropped: 0 });
    const full = turns(ASK_TURN_WINDOW);
    expect(carriedTurns(full)).toEqual({ carried: full, dropped: 0 });
  });

  it('leaves more than half the prompt budget to the sources at every turn’s worst case', () => {
    expect(ASK_TURN_WINDOW * (EMBED_INPUT_CAP + REPLY_TOKEN_RESERVE)).toBeLessThan(
      PROMPT_TOKEN_BUDGET / 2,
    );
  });
});
