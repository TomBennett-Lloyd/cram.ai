import type { LectureId, LectureSummary, RetrievedSlide } from '@cram/shared';
import {
  failureMessage,
  MAKE_SUMMARY,
  NO_SUMMARY,
  PENDING,
  SOURCE_MISSING,
  storedUnavailableMessage,
  SUMMARY,
  SUMMARY_FAILED,
  SUMMARY_REPLACED,
} from '../copy';
import type { CitedSlide } from '../ask/cited-slide';
import { SlideCard } from '../ask/SlideCard';
import { Empty, Failed, Pending } from '../shell/async-states';
import type { SummariesState } from './use-summaries';

type OnOpen = (cited: CitedSlide) => void;

/** A line's slides in citation order, each once, with the line's quotes from it; a slide the reply lacks is counted. */
const lineSlides = (
  unit: LectureSummary['units'][number],
  slides: readonly RetrievedSlide[],
): { readonly cited: readonly CitedSlide[]; readonly missing: number } => {
  const cited: CitedSlide[] = [];
  let missing = 0;
  for (const sourceId of new Set(unit.citations.map((citation) => citation.sourceId))) {
    const slide = slides.find((candidate) => candidate.sourceId === sourceId);
    if (slide === undefined) missing++;
    else
      cited.push({
        slide,
        quotes: unit.citations
          .filter((citation) => citation.sourceId === sourceId)
          .map(({ quote }) => quote),
      });
  }
  return { cited, missing };
};

const Lines = ({
  summary,
  slides,
  onOpen,
}: {
  readonly summary: LectureSummary;
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => (
  <ol className="summary-lines">
    {summary.units.map((unit, index) => {
      const { cited, missing } = lineSlides(unit, slides);
      return (
        <li key={index} className="unit">
          <p className="unit-text">{unit.text}</p>
          <ul className="citations" aria-label="Sources">
            {cited.map((entry) => (
              <li key={entry.slide.sourceId}>
                <SlideCard
                  slide={entry.slide}
                  onOpen={() => {
                    onOpen(entry);
                  }}
                />
              </li>
            ))}
            {missing > 0 && <li className="citation-missing">{SOURCE_MISSING}</li>}
          </ul>
        </li>
      );
    })}
  </ol>
);

const SummaryBody = ({
  lectureId,
  state,
  onLoad,
  onOpen,
}: {
  readonly lectureId: LectureId;
  readonly state: SummariesState;
  readonly onLoad: () => void;
  readonly onOpen: OnOpen;
}) => {
  switch (state.status) {
    case 'idle':
      return null;
    case 'pending':
      return <Pending label={PENDING.summary} />;
    case 'unreachable':
    case 'malformed':
      return <Failed messages={[failureMessage(state)]} onRetry={onLoad} />;
    case 'refused':
      return <Failed messages={[failureMessage(state)]} />;
    case 'ok': {
      const { value } = state;
      if (value.state === 'course-unavailable')
        return <Failed messages={[storedUnavailableMessage(value.problem)]} />;
      const summary = value.summaries.find((candidate) => candidate.lectureId === lectureId);
      return summary === undefined ? (
        <Empty>{SUMMARY_REPLACED}</Empty>
      ) : (
        <Lines summary={summary} slides={value.slides} onOpen={onOpen} />
      );
    }
  }
};

/** A summarised lecture's lines, folded until opened, which is when they are read. */
export const SummaryDetails = ({
  lectureId,
  state,
  onLoad,
  onOpen,
}: {
  readonly lectureId: LectureId;
  readonly state: SummariesState;
  readonly onLoad: () => void;
  readonly onOpen: OnOpen;
}) => (
  <details
    className="lecture-summary"
    onToggle={(event) => {
      if (event.currentTarget.open) onLoad();
    }}
  >
    <summary>{SUMMARY}</summary>
    <SummaryBody lectureId={lectureId} state={state} onLoad={onLoad} onOpen={onOpen} />
  </details>
);

/**
 * A lecture with no summary, and the act that makes one; `tried` is a summary this session could
 * not make. The button stays while a re-make runs, so the reader's focus is not dropped.
 */
export const NoSummary = ({
  busy,
  tried,
  onRemake,
}: {
  readonly busy: boolean;
  readonly tried: boolean;
  readonly onRemake: () => void;
}) => (
  <p className="lecture-summary-state" aria-busy={busy}>
    {busy ? PENDING.remake : tried ? SUMMARY_FAILED : NO_SUMMARY}{' '}
    <button type="button" aria-disabled={busy} onClick={busy ? undefined : onRemake}>
      {MAKE_SUMMARY}
    </button>
  </p>
);
