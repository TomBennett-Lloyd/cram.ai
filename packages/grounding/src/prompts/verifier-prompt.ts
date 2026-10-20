import { type ChatRequest, OutputName } from '@cram/gateway';
import { Verdict } from '@cram/shared';
import { z } from 'zod';
import type { VerifierInput } from '../verifier-input';
import { statementBlock } from './statement-block';

export const VerdictReply = z.strictObject({ verdict: Verdict });
export type VerdictReply = z.infer<typeof VerdictReply>;

const INSTRUCTIONS = `You check one statement against quotes from a student's lecture slides.
Judge only whether the quotes, taken together, say what the statement says. Use nothing but the quotes: no knowledge of your own, and nothing the slides might say beyond them.

Give one verdict:
- supported: everything the statement says, the quotes say or directly imply.
- partial: the quotes say some of what the statement says, and not the rest.
- unsupported: the quotes say none of it, or they say the opposite of any part of it.

The input is a JSON object: "quotes" is the list of quotes, and "statement" is the statement.`;

const VERDICT = OutputName.parse('verdict');

/** The LLM verification path: the generator role under this prompt (`docs/adr/0003-model-roles-and-backends.md` § Decision (a), (d)). */
export const verifierRequest = (input: VerifierInput): ChatRequest<VerdictReply> => ({
  messages: [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: statementBlock(input) },
  ],
  output: { name: VERDICT, schema: VerdictReply },
});
