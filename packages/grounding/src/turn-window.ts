import type { AskTurn } from '@cram/shared';

/**
 * How many of a thread's newest turns Ask carries into the rewrite and the prompt
 * (`docs/adr/0011-ask-conversation.md` § Decision (b)), tuned against the eval's
 * `followUpRetrieval` row within the bound `turn-window.test.ts` asserts. Its ledger:
 * `.claude/ledgers/ask-turn-window.ledger`.
 */
export const ASK_TURN_WINDOW = 4;

export interface CarriedTurns {
  readonly carried: readonly AskTurn[];
  readonly dropped: number;
}

/** The newest `ASK_TURN_WINDOW` turns in order, and how many older ones were left behind. */
export const carriedTurns = (turns: readonly AskTurn[]): CarriedTurns => {
  const dropped = Math.max(0, turns.length - ASK_TURN_WINDOW);
  return { carried: turns.slice(dropped), dropped };
};
