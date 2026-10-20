import type { VerifierInput } from '../verifier-input';

/** The statement and its quotes as both statement prompts show them; the variable half of each. */
export const statementBlock = (input: VerifierInput): string =>
  [
    ...input.quotes.map((quote) => `<quote>${quote}</quote>`),
    `<statement>${input.text}</statement>`,
  ].join('\n');
