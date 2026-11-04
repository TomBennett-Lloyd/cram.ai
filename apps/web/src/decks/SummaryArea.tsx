import type { IngestStatus, LectureId } from '@cram/shared';
import type { CitedSlide } from '../ask/cited-slide';
import { NoSummary, SummaryDetails, SummaryWithheld } from './LectureSummary';
import { remaking } from './use-ingest-status';
import type { SummariesState } from './use-summaries';

/** What the decks screen does for a lecture's summary: read the lines, open a slide, make one again. */
export interface SummaryActs {
  readonly summaries: SummariesState;
  readonly loadSummaries: () => void;
  readonly onOpen: (cited: CitedSlide) => void;
  readonly requested: ReadonlySet<LectureId>;
  readonly pressed: ReadonlySet<LectureId>;
  readonly onRemake: (lectureId: LectureId) => void;
}

/** The lecture's summary lines, or why it has none, and the lines withheld from it; a lecture the file does not list has neither. */
export const SummaryArea = ({
  lectureId,
  ingest,
  acts,
}: {
  readonly lectureId: LectureId;
  readonly ingest: Omit<IngestStatus, 'courseId'>;
  readonly acts: SummaryActs;
}) => {
  const { stored, uploads, remakes } = ingest;
  const lecture =
    stored.state === 'read'
      ? stored.lectures.find((each) => each.lectureId === lectureId)
      : undefined;
  if (lecture === undefined) return null;
  const withheld = (
    <SummaryWithheld
      lectureId={lectureId}
      count={lecture.withheld}
      state={acts.summaries}
      onLoad={acts.loadSummaries}
      onOpen={acts.onOpen}
    />
  );
  if (lecture.summarised)
    return (
      <>
        <SummaryDetails
          lectureId={lectureId}
          state={acts.summaries}
          onLoad={acts.loadSummaries}
          onOpen={acts.onOpen}
        />
        {withheld}
      </>
    );
  const remake = remakes.find((each) => each.lectureId === lectureId)?.progress;
  const tried =
    remake !== undefined ||
    uploads.some((upload) => upload.lectureId === lectureId && upload.progress.state === 'indexed');
  return (
    <>
      <NoSummary
        busy={acts.requested.has(lectureId) || (remake !== undefined && remaking(remake))}
        tried={tried}
        pressed={acts.pressed.has(lectureId)}
        withheld={lecture.withheld > 0}
        onRemake={() => {
          acts.onRemake(lectureId);
        }}
      />
      {withheld}
    </>
  );
};
