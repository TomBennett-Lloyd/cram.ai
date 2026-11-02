import { PROVISIONAL_GENERATOR_CONTEXT_LENGTH } from '@cram/gateway';

/**
 * Tokens kept for the reply (`docs/adr/0009-explanation-answers.md` § Decision (j)): about three
 * times the longest summary reply #422's probe measured (its plan comment, step 3). Its ledger:
 * `.claude/ledgers/prompt-token-budget.ledger`.
 */
export const REPLY_TOKEN_RESERVE = 2048;

/** Tokens a prompt may hold, by `estimateTokens`. */
export const PROMPT_TOKEN_BUDGET = PROVISIONAL_GENERATOR_CONTEXT_LENGTH - REPLY_TOKEN_RESERVE;

/** Below the fewest characters per prompt token #422's probe measured, so `estimateTokens` errs long. */
export const PROMPT_CHARS_PER_TOKEN = 3.5;

export const estimateTokens = (text: string): number =>
  Math.ceil(text.length / PROMPT_CHARS_PER_TOKEN);
