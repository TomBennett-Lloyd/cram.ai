import { type ChatRequest, OutputName } from '@cram/gateway';
import { Unit } from '@cram/shared';
import { z } from 'zod';
import type { VerifierInput } from '../verifier-input';
import { statementBlock } from './statement-block';

export const RewriteReply = z.strictObject({ text: Unit.shape.text });
export type RewriteReply = z.infer<typeof RewriteReply>;

const INSTRUCTIONS = `You rewrite one statement from a student's study material so that it says only what its quotes from the student's lecture slides say.
Keep every part of the statement the quotes say. Remove or narrow every part they do not. Add nothing the quotes do not say, and do not name a lecture or a slide.

The quotes come first, each inside a <quote> tag, then the statement inside a <statement> tag. Reply with the rewritten statement.`;

const REWRITE = OutputName.parse('rewrite');

/** The one rewrite `rewrite-once` allows (`docs/standards/grounding.md` rule 4); the unit keeps its citations. */
export const rewriteRequest = (input: VerifierInput): ChatRequest<RewriteReply> => ({
  messages: [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: statementBlock(input) },
  ],
  output: { name: REWRITE, schema: RewriteReply },
});
