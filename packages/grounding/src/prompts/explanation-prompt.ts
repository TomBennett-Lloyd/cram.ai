import { type ChatRequest, OutputName } from '@cram/gateway';
import { type AskTurn, NonBlankText } from '@cram/shared';
import type { AssembledContext } from '../assemble-context';
import { z } from 'zod';
import { LineCitation } from './generation-prompt';
import { sourceBlock, summaryBlock } from './source-block';

/** `null` is the model's "the slides do not cover this" (`docs/adr/0009-explanation-answers.md` § Decision (b)). */
export const GeneratedExplanation = z.strictObject({
  answer: z.strictObject({ text: NonBlankText, quotes: z.array(LineCitation) }).nullable(),
});
export type GeneratedExplanation = z.infer<typeof GeneratedExplanation>;

const RULES = `You explain a student's own lecture slides to them.
You are given the slides that matter for the student's question, each inside a <source> tag with its id, one line to a row with the line's number in square brackets before it. After them may come a summary of each lecture those slides belong to, inside a <summary> tag with the lecture's id, one point to a row. Then comes the question. The sources are the slides and the summaries.
Before the question may come earlier turns of this conversation, each inside a <turn> tag: what the student asked, inside a <student> tag, then what you answered, inside a <tutor> tag. The turns say what the question refers to. They are not sources: take no fact from them and quote no line of them.

Rules:
- Answer the question with one explanation of what the sources say about it, drawn from all of them together and written in your own words.
- Explain this course only. Every fact about the subject in your explanation comes from the sources. You may use what you know to make them clear, such as what a word means or how two sources connect, but never to add a fact they do not state, and add no comments of your own on what they say.
- Do not name a lecture, a slide or a line number in the text.
- Where your text repeats a whole line of a <source> word for word, list that line in "quotes" as the source's id and the line's number. List no other line, and no row of a summary.
- If the sources do not say what the question asks, even when they say other things about its subject, the answer is null.`;

const GENERATED_EXPLANATION = OutputName.parse('explanation');

export const NOT_COVERED_TURN = 'The slides do not cover this.';

export const turnBlock = ({ question, answer }: AskTurn): string =>
  `<turn>\n<student>${question}</student>\n<tutor>${answer ?? NOT_COVERED_TURN}</tutor>\n</turn>`;

/** Fixed text first, so a backend's prompt-prefix cache applies (`docs/adr/0003-model-roles-and-backends.md` § Decision (h)); summaries after the slides (`docs/adr/0009-explanation-answers.md` § Decision (b)); the carried turns after both, as context and never a source (`docs/adr/0011-ask-conversation.md` § Decision (c)). */
export const explanationRequest = (
  question: string,
  { raw, summaries }: Pick<AssembledContext, 'raw' | 'summaries'>,
  turns: readonly AskTurn[],
): ChatRequest<GeneratedExplanation> => ({
  messages: [
    { role: 'system', content: RULES },
    {
      role: 'user',
      content: [
        ...raw.map(sourceBlock),
        ...summaries.map(summaryBlock),
        ...turns.map(turnBlock),
        `<question>${question}</question>`,
      ].join('\n\n'),
    },
  ],
  output: { name: GENERATED_EXPLANATION, schema: GeneratedExplanation },
});
