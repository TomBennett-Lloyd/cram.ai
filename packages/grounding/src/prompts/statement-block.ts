import type { VerifierInput } from '../verifier-input';

export const statementBlock = (input: VerifierInput): string =>
  JSON.stringify({ quotes: input.quotes, statement: input.text });
