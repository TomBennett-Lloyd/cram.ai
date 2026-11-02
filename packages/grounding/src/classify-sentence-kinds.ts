import type { Generator } from '@cram/gateway';
import { type SentenceKind, sentenceKindRequest } from './prompts/sentence-kind-prompt';

/** One kind per sentence, in order; any failed or invalid reply reads every sentence as a course claim (`docs/adr/0009-explanation-answers.md` § Decision (e)). */
export const classifySentenceKinds = async (
  sentences: readonly string[],
  premises: readonly string[],
  generator: Pick<Generator, 'chat'>,
): Promise<readonly SentenceKind[]> => {
  if (sentences.length === 0) return [];
  const reply = await generator.chat(sentenceKindRequest(sentences, premises));
  return reply.status === 'completed'
    ? reply.value.kinds
    : sentences.map((): SentenceKind => 'course-claim');
};
