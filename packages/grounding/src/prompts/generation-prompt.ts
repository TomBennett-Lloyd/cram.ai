import { type ChatRequest, OutputName } from '@cram/gateway';
import { type RetrievedSlide, SourceId, Unit } from '@cram/shared';
import { z } from 'zod';
import { sourceBlock } from './source-block';

export const SlideLineNo = z.number().int().brand<'SlideLineNo'>();
export type SlideLineNo = z.infer<typeof SlideLineNo>;

export const LineCitation = z.strictObject({
  sourceId: SourceId,
  line: SlideLineNo,
});
export type LineCitation = z.infer<typeof LineCitation>;

const GeneratedUnit = z.strictObject({ text: Unit.shape.text, citations: z.array(LineCitation) });

export const GeneratedUnits = z.strictObject({ units: z.array(GeneratedUnit) });
export type GeneratedUnits = z.infer<typeof GeneratedUnits>;

export interface SummaryTask {
  readonly kind: 'lecture-summary';
  readonly lectureTitle: string;
  readonly maxUnits: number;
}

export type GenerationTask = SummaryTask;

const RULES = `You write study material for a student, using only the student's own lecture slides.
You are given the slides that matter for this request, each inside a <source> tag with its id, one line to a row with the line's number in square brackets before it, and then the request.

Rules:
- Write only what the sources say. Add nothing they do not say: no knowledge of your own, and no comments of your own on what they say.
- Write the material as separate units. A unit may bring together what several sources say.
- Write each unit in your own words, as a plain statement of what the slides say: put what they say together and say it directly, rather than repeating their lines. Do not name a lecture or a slide in the text: the citations do that.
- Every unit cites at least one line. A citation is a source's id and the number of one of its lines that shows the unit comes from it. Cite every line the unit draws on.
- A unit's cited lines, read on their own without the rest of the source, must say everything the unit says. A line that leaves its subject to the source's title or to another line, such as one that begins "She", "They" or "It", or one that gives an instruction, does not say it on its own: cite that title or line as well. For example, if a source's line [1] is "The kettle" and its line [3] is "It boils in two minutes", the unit "The kettle boils in two minutes." cites lines 1 and 3.
- If the sources do not cover the request, return no units.`;

const taskLine = (task: GenerationTask): string =>
  `The request is the title of the lecture the sources come from, and the sources are that lecture's own slides. Summarise what the lecture teaches in at most ${String(task.maxUnits)} units, drawn from the whole lecture, its last slides as well as its first. Each unit is one full sentence stating one fact or instruction a slide gives, plainly and with nothing added: no definition, reason, example or consequence the slide does not give. A slide's title, or a topic in a list of the lecture's topics, is not a unit, and no unit says what the lecture covers. A line's number is the one in square brackets at the start of its row. Cite the line that states the fact or instruction, and the slide's title as well when the unit needs it to make sense. Return no units only if no slide teaches anything.`;

const requestLine = (task: GenerationTask): string => `<lecture>${task.lectureTitle}</lecture>`;

const GENERATED_UNITS = OutputName.parse('units');

/** Fixed text first, so a backend's prompt-prefix cache applies (`docs/adr/0003-model-roles-and-backends.md` § Decision (h)). */
export const generationRequest = (
  task: GenerationTask,
  slides: readonly RetrievedSlide[],
): ChatRequest<GeneratedUnits> => ({
  messages: [
    { role: 'system', content: `${RULES}\n\n${taskLine(task)}` },
    { role: 'user', content: [...slides.map(sourceBlock), requestLine(task)].join('\n\n') },
  ],
  output: {
    name: GENERATED_UNITS,
    schema: z.strictObject({ units: z.array(GeneratedUnit).min(1).max(task.maxUnits) }),
  },
});
