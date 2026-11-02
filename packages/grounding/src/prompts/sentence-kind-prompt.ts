import { type ChatRequest, OutputName } from '@cram/gateway';
import { z } from 'zod';

export const SentenceKind = z.enum(['course-claim', 'interpretation']);
export type SentenceKind = z.infer<typeof SentenceKind>;

const INSTRUCTIONS = `You sort the sentences of an explanation of a student's lecture slides into two kinds. The premises are the slides the explanation was written from.

Give each numbered sentence one kind:
- course-claim: it states something about the course's subject — a fact, figure, name, rule, step, cause or event — that the slides would have to say for the sentence to report them.
- interpretation: it explains what the slides say without adding to it — what a term or phrase means, how two points connect, why one point follows from another, or the same point put in other words.

Judge only what kind of sentence each one is, never whether the slides or anyone else would agree with it.

The input is a JSON object: "premises" is the list of slide texts, and "sentences" is the list of sentences, each with its number. Reply with "kinds": one kind per sentence, in the sentences' order.`;

const SENTENCE_KINDS = OutputName.parse('sentence-kinds');

const reply = (count: number) => z.strictObject({ kinds: z.array(SentenceKind).length(count) });
export type SentenceKindReply = z.infer<ReturnType<typeof reply>>;

/** The judge call of `docs/adr/0009-explanation-answers.md` § Decision (e); the reply's length is the schema's, so the backend is constrained to it (#366's A13). */
export const sentenceKindRequest = (
  sentences: readonly string[],
  premises: readonly string[],
): ChatRequest<SentenceKindReply> => ({
  messages: [
    { role: 'system', content: INSTRUCTIONS },
    {
      role: 'user',
      content: JSON.stringify({
        premises,
        sentences: sentences.map((text, index) => ({ number: index + 1, text })),
      }),
    },
  ],
  output: { name: SENTENCE_KINDS, schema: reply(sentences.length) },
});
