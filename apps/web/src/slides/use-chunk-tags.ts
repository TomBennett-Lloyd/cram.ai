import {
  type BrowsedSlide,
  type ChunkTag,
  type CourseId,
  type TagEdit,
  tagOrder,
  type TopicTag,
} from '@cram/shared';
import { useRef, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiFailure } from '../api/api-result';

export interface ChunkTags {
  readonly tags: readonly ChunkTag[];
  readonly failure: ApiFailure | undefined;
  readonly edit: (tags: readonly TopicTag[]) => void;
}

const expected = (shown: readonly ChunkTag[], tags: readonly TopicTag[]): readonly ChunkTag[] =>
  tags
    .map((tag) => shown.find((held) => held.tag === tag) ?? { tag, origin: 'student' as const })
    .sort(tagOrder);

const taken = <T>(ref: { current: T | undefined }): T | undefined => {
  const value = ref.current;
  ref.current = undefined;
  return value;
};

/** An edit shows at once, a held tag keeping its origin (`CourseIndex.editTopics`); writes go one at a time against the chunk's text (#534) and the list last stored (#507), the latest winning. */
export const useChunkTags = (
  api: ApiClient,
  courseId: CourseId,
  fact: Pick<TagEdit, 'sourceId' | 'chunkNo' | 'textHash'>,
  stored: readonly ChunkTag[],
  onSlideChanged: (slide: BrowsedSlide, failure: ApiFailure) => void,
): ChunkTags => {
  const [shown, setShown] = useState(stored);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  const saved = useRef(stored);
  const next = useRef<readonly TopicTag[] | undefined>(undefined);
  const writing = useRef(false);
  const write = async (): Promise<void> => {
    writing.current = true;
    for (let tags = taken(next); tags !== undefined; tags = taken(next)) {
      const result = await api.editTags(courseId, {
        ...fact,
        base: [...saved.current],
        tags: [...tags],
      });
      if (result.status === 'ok') {
        saved.current = result.value.tags;
        if (next.current === undefined) setShown(result.value.tags);
      } else {
        next.current = undefined;
        if (result.status === 'refused' && result.refusal.status === 'tags-changed')
          saved.current = result.refusal.tags;
        setShown(saved.current);
        setFailure(result);
        if (result.status === 'refused' && result.refusal.status === 'chunk-changed')
          onSlideChanged(result.refusal.slide, result);
      }
    }
    writing.current = false;
  };
  const edit = (tags: readonly TopicTag[]): void => {
    setShown(expected(shown, tags));
    setFailure(undefined);
    next.current = tags;
    if (!writing.current) void write();
  };
  return { tags: shown, failure, edit };
};
