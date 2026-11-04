/**
 * The bound for a test, or its hook, whose work is proportional to a table it sweeps or the PDFs it renders rather
 * than to its assertion; restated only where it cannot be imported (`.claude/ledgers/sweep-test-timeout.ledger`).
 * Tuned against #588's census of these tests under concurrent lane load.
 */
export const SWEEP_TEST_TIMEOUT_MS = 60_000;
