import { type ChatRequest, OutputName } from '@cram/gateway';
import { z } from 'zod';

/** Tags one fact's reply may hold; provisional, and #426's eval run reports what it produced. */
export const TAGS_PER_FACT = 6;

/** Characters one tag may hold; a short statement still fits, so the prompt is what keeps a tag a noun phrase (`docs/adr/0001-grounding-architecture.md` § Decision (b)). */
export const TAG_MAX_CHARS = 40;

const INSTRUCTIONS = `You name the topics a passage of a student's lecture slides is about, so the student can find the passage again by topic.

A topic is a short noun phrase a student might search for: a subject, a thing, a process or a named idea, in the passage's own words wherever it has them. Name the passage's own subject, and also the subject of any example the passage uses: a passage about drug interactions whose example is a patient with diabetes is about drug interactions and about diabetes.

A topic names what the passage is about, never what the passage says about it: never a sentence, a claim or a judgement.

The input is a JSON object: "lecture" is the lecture's title, and "passage" is the passage. Reply with "tags": the passage's topics, most central first, or none if it has no subject.`;

const TOPIC_TAGS = OutputName.parse('topic-tags');

export const TagReply = z.strictObject({
  tags: z.array(z.string().max(TAG_MAX_CHARS)).max(TAGS_PER_FACT),
});
export type TagReply = z.infer<typeof TagReply>;

/** The tag call of `docs/plan.md` §3.2: one passage, one call; the reply's bounds are the schema's, so the backend is constrained to them. */
export const tagRequest = (lectureTitle: string, passage: string): ChatRequest<TagReply> => ({
  messages: [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: JSON.stringify({ lecture: lectureTitle, passage }) },
  ],
  output: { name: TOPIC_TAGS, schema: TagReply },
});
