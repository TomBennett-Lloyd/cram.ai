import type { Generator } from '@cram/gateway';
import {
  type ChunkNo,
  type RetrievedSlide,
  type SlideChunk,
  SlideKind,
  type SourceId,
  TopicTag,
} from '@cram/shared';
import type { ModelFailure } from './model-failure';
import { estimateTokens, PROMPT_TOKEN_BUDGET } from './prompt-budget';
import { tagRequest } from './prompts/tag-prompt';
import { slideText } from './slide-text';

export interface TagFact {
  readonly sourceId: SourceId;
  readonly lectureTitle: string;
  readonly chunk: SlideChunk;
}

export type UntaggedReason = 'no-text' | 'over-budget' | ModelFailure['status'];

export type FactTagging = { readonly sourceId: SourceId; readonly chunkNo: ChunkNo } & (
  | { readonly status: 'tagged'; readonly tags: readonly TopicTag[] }
  | { readonly status: 'untagged'; readonly reason: UntaggedReason }
);

export interface TagDeps {
  readonly generator: Pick<Generator, 'chat'>;
  readonly budget?: number;
}

const tagsOf = (topics: readonly string[]): readonly TopicTag[] => {
  const kept = new Map<string, string>();
  for (const topic of topics.map((text) => text.trim()))
    if (topic !== '' && !kept.has(topic.toLowerCase())) kept.set(topic.toLowerCase(), topic);
  return [...kept.values()].map((topic) => TopicTag.parse(topic));
};

export const lectureFacts = (
  slides: readonly RetrievedSlide[],
  chunksOf: (sourceId: SourceId) => readonly SlideChunk[],
): readonly TagFact[] =>
  slides
    .filter(({ record }) => record.kind !== SlideKind.enum.references)
    .flatMap(({ sourceId, record }) =>
      chunksOf(sourceId).map((chunk) => ({ sourceId, lectureTitle: record.lectureTitle, chunk })),
    );

const promptTokens = (fact: TagFact): number =>
  tagRequest(fact.lectureTitle, slideText(fact.chunk)).messages.reduce(
    (total, { content }) => total + estimateTokens(content),
    0,
  );

/** One call per fact (`docs/plan.md` §3.2); a backend failure ends the pass, so a backend that is down costs one call. */
export const tagFacts = async (
  facts: readonly TagFact[],
  deps: TagDeps,
): Promise<readonly FactTagging[]> => {
  const budget = deps.budget ?? PROMPT_TOKEN_BUDGET;
  const outcomes: FactTagging[] = [];
  let down = false;
  for (const fact of facts) {
    const ref = { sourceId: fact.sourceId, chunkNo: fact.chunk.chunkNo };
    const passage = slideText(fact.chunk);
    if (passage === '') outcomes.push({ ...ref, status: 'untagged', reason: 'no-text' });
    else if (promptTokens(fact) > budget)
      outcomes.push({ ...ref, status: 'untagged', reason: 'over-budget' });
    else if (down) outcomes.push({ ...ref, status: 'untagged', reason: 'backend-failed' });
    else {
      const reply = await deps.generator.chat(tagRequest(fact.lectureTitle, passage));
      down = reply.status === 'backend-failed';
      outcomes.push(
        reply.status === 'completed'
          ? { ...ref, status: 'tagged', tags: tagsOf(reply.value.tags) }
          : { ...ref, status: 'untagged', reason: reply.status },
      );
    }
  }
  return outcomes;
};
