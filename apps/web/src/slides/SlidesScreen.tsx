import type { BrowsedChunk, BrowsedSlide, CourseId, LectureId } from '@cram/shared';
import { useState } from 'react';
import { useApi } from '../api/api-context';
import type { ApiClient } from '../api/api-client';
import type { ApiFailure } from '../api/api-result';
import {
  chunkName,
  DERIVED_SOURCE,
  failureMessage,
  LECTURE_NOT_STORED,
  NO_SLIDES,
  PENDING,
  SEE_DECKS,
  SLIDE_HAS_NO_TEXT,
} from '../copy';
import { Empty, Failed, Pending } from '../shell/async-states';
import { hrefOf } from '../shell/route';
import { TagEditor } from './TagEditor';
import { useChunkTags } from './use-chunk-tags';
import { useLectureSlides } from './use-lecture-slides';

const ChunkView = ({
  api,
  courseId,
  slide,
  chunk,
  onEdit,
  onSlideChanged,
}: {
  readonly api: ApiClient;
  readonly courseId: CourseId;
  readonly slide: BrowsedSlide;
  readonly chunk: BrowsedChunk;
  readonly onEdit: () => void;
  readonly onSlideChanged: (slide: BrowsedSlide, failure: ApiFailure) => void;
}) => {
  const { sourceId, record, chunks } = slide;
  const { chunkNo, textHash } = chunk;
  const { tags, failure, edit } = useChunkTags(
    api,
    courseId,
    { sourceId, chunkNo, textHash },
    chunk.tags,
    onSlideChanged,
  );
  return (
    <div className="browsed-chunk">
      {chunk.lines.length === 0 ? (
        <Empty>{SLIDE_HAS_NO_TEXT}</Empty>
      ) : (
        <p className="browsed-chunk-lines">{chunk.lines.join('\n')}</p>
      )}
      <TagEditor
        name={chunkName(record.slideNo, chunkNo, chunks.length)}
        tags={tags}
        failure={failure}
        onEdit={(next) => {
          onEdit();
          edit(next);
        }}
      />
    </div>
  );
};

const SlideView = ({
  api,
  courseId,
  slide: read,
}: {
  readonly api: ApiClient;
  readonly courseId: CourseId;
  readonly slide: BrowsedSlide;
}) => {
  const [slide, setSlide] = useState(read);
  const [failure, setFailure] = useState<ApiFailure | undefined>(undefined);
  return (
    <li className="browsed-slide">
      <h2>
        <span className="browsed-slide-number">Slide {slide.record.slideNo}</span>{' '}
        {slide.record.title}
      </h2>
      {slide.record.derived && <p className="browsed-slide-derived">{DERIVED_SOURCE}</p>}
      {failure !== undefined && <Failed messages={[failureMessage(failure)]} />}
      {slide.chunks.map((chunk) => (
        <ChunkView
          key={`${String(chunk.chunkNo)} ${chunk.textHash}`}
          api={api}
          courseId={courseId}
          slide={slide}
          chunk={chunk}
          onEdit={() => {
            setFailure(undefined);
          }}
          onSlideChanged={(stored, refused) => {
            setSlide(stored);
            setFailure(refused);
          }}
        />
      ))}
    </li>
  );
};

/** A lecture's slides with each chunk's topic tags, which the student edits (#428). */
export const SlidesScreen = ({
  courseId,
  lectureId,
}: {
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
}) => {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const state = useLectureSlides(api, courseId, lectureId, revision);
  if (state.status === 'pending')
    return (
      <main className="screen">
        <Pending label={PENDING.slides} />
      </main>
    );
  if (state.status === 'refused' && state.refusal.status === 'not-found')
    return (
      <main className="screen">
        <Empty>
          {LECTURE_NOT_STORED} <a href={hrefOf({ screen: 'decks', courseId })}>{SEE_DECKS}</a>.
        </Empty>
      </main>
    );
  if (state.status !== 'ok')
    return (
      <main className="screen">
        <Failed
          messages={[failureMessage(state)]}
          onRetry={() => {
            setRevision((value) => value + 1);
          }}
        />
      </main>
    );
  const { slides } = state.value;
  return (
    <main className="screen">
      <h1>{slides[0]?.record.lectureTitle ?? lectureId}</h1>
      {slides.length === 0 ? (
        <Empty>{NO_SLIDES}</Empty>
      ) : (
        <ol className="browsed-slides">
          {slides.map((slide) => (
            <SlideView key={slide.sourceId} api={api} courseId={courseId} slide={slide} />
          ))}
        </ol>
      )}
    </main>
  );
};
