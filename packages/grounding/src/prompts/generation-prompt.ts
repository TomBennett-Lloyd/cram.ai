import { type ChatRequest, OutputName } from '@cram/gateway';
import { Unit } from '@cram/shared';
import { z } from 'zod';
import { type RetrievedSlide, slideText } from '../slide-text';

export const GeneratedUnits = z.strictObject({
  units: z.array(z.strictObject({ text: Unit.shape.text, citations: Unit.shape.citations })),
});
export type GeneratedUnits = z.infer<typeof GeneratedUnits>;

export interface AskTask {
  readonly kind: 'answer-sentence';
  readonly question: string;
}

/** One arm per feature that generates; each feature's task line joins `TASK_LINES`. */
export type GenerationTask = AskTask;

const RULES = `You write study material for a student, using only the student's own lecture slides.
You are given the slides that matter for this request, each inside a <source> tag with its id, and then the request.

Rules:
- Write only what the sources say. Add nothing they do not say: no knowledge of your own, and no comments of your own on what they say.
- Write the material as separate units. A unit may bring together what several sources say.
- Every unit cites at least one source. A citation is the source's id and a quote copied exactly, character for character, from that source's text, that shows the unit comes from it.
- Write each unit as a plain statement of what the slides say. Do not name a lecture or a slide in the text: the citations do that.
- If the sources do not cover the request, return no units.`;

const TASK_LINES: Record<GenerationTask['kind'], string> = {
  'answer-sentence':
    "The request is the student's question. Answer it in units of one sentence each.",
};

const requestLine = (task: GenerationTask): string => `<question>${task.question}</question>`;

const sourceBlock = (slide: RetrievedSlide): string =>
  `<source id="${slide.sourceId}">\n${slideText(slide.record)}\n</source>`;

const GENERATED_UNITS = OutputName.parse('units');

/** Fixed text first, so a backend's prompt-prefix cache applies (`docs/adr/0003-model-roles-and-backends.md` § Decision (h)). */
export const generationRequest = (
  task: GenerationTask,
  slides: readonly RetrievedSlide[],
): ChatRequest<GeneratedUnits> => ({
  messages: [
    { role: 'system', content: `${RULES}\n\n${TASK_LINES[task.kind]}` },
    { role: 'user', content: [...slides.map(sourceBlock), requestLine(task)].join('\n\n') },
  ],
  output: { name: GENERATED_UNITS, schema: GeneratedUnits },
});
