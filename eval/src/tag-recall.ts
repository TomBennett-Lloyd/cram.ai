import type { FactTagging } from '@cram/grounding';
import { namedTags, sourceIdOf } from '@cram/index';
import type { TopicTag } from '@cram/shared';
import { type BaselineRow, baselineRow } from './metric-row';
import type { TopicLabel } from './topic-label';

/** `tagRecall`: of the labelled (slide, topic) pairs, those where a tag on one of the slide's chunks is one `namedTags` finds in the topic (#426). */
export const tagRecall = (
  labels: readonly TopicLabel[],
  tagged: readonly FactTagging[],
): BaselineRow => {
  const tagsOf = new Map<string, TopicTag[]>();
  for (const fact of tagged)
    if (fact.status === 'tagged')
      tagsOf.set(fact.sourceId, [...(tagsOf.get(fact.sourceId) ?? []), ...fact.tags]);
  const pairs = labels.flatMap((label) =>
    label.tags.map((topic) => ({ tags: tagsOf.get(sourceIdOf(label)) ?? [], topic })),
  );
  const recalled = pairs.filter(({ tags, topic }) => namedTags(topic, tags).length > 0);
  return baselineRow(recalled.length, pairs.length, 'no slide carries a golden topic');
};
