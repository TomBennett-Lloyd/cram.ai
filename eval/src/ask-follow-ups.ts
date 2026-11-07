import type { ModelGateway } from '@cram/gateway';
import {
  ask,
  carriedTurns,
  type ExplainResult,
  type StandaloneOutcome,
  standaloneQuestion,
} from '@cram/grounding';
import type { RetrievedSlide } from '@cram/shared';
import { lightDeps } from './ask-depths';
import type { FollowUpItem } from './follow-up';
import type { IndexRetriever } from './index-retriever';

type RewriteFailed = Extract<StandaloneOutcome, { readonly status: 'model-failed' }>;

export type AskedFollowUp =
  | {
      readonly status: 'rewrite-failed';
      readonly item: FollowUpItem;
      readonly rewrite: RewriteFailed;
    }
  | {
      readonly status: 'asked';
      readonly item: FollowUpItem;
      readonly rewrite: string;
      readonly retrieved: readonly RetrievedSlide[];
      /** What the item's standalone form retrieves: the most the rewrite could find. */
      readonly ceiling: readonly RetrievedSlide[];
      readonly result: ExplainResult;
    };

/** Each follow-up as the server runs it (`docs/adr/0011-ask-conversation.md` § Decision (d) and (g)): the rewrite, retrieval on it, the light ask with the carried turns; and the standalone form's retrieval beside it. */
export const askFollowUps = async (
  items: readonly FollowUpItem[],
  retriever: IndexRetriever,
  gateway: ModelGateway,
): Promise<readonly AskedFollowUp[]> => {
  const deps = lightDeps(retriever, gateway);
  const asked: AskedFollowUp[] = [];
  for (const item of items) {
    const { carried } = carriedTurns(item.turns);
    const rewrite = await standaloneQuestion(item.question, carried, gateway.generator);
    if (rewrite.status === 'model-failed') {
      asked.push({ status: 'rewrite-failed', item, rewrite });
      continue;
    }
    const retrieved = await retriever.retrieve(rewrite.question);
    const ceiling = await retriever.retrieve(item.standalone);
    const summaries = retriever.summariesFor(retrieved);
    const result = await ask(
      { question: item.question, turns: [...carried] },
      { retrieved, summaries },
      deps,
    );
    asked.push({ status: 'asked', item, rewrite: rewrite.question, retrieved, ceiling, result });
  }
  return asked;
};
