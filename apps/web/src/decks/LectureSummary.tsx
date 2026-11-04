import type { LectureDigest, LectureId, RetrievedSlide, Unit } from '@cram/shared';
import type { ReactNode } from 'react';
import {
  failureMessage,
  MAKE_SUMMARY,
  NO_SUMMARY,
  PENDING,
  SOURCE_MISSING,
  storedUnavailableMessage,
  SUMMARY,
  SUMMARY_ALL_WITHHELD,
  SUMMARY_FAILED,
  SUMMARY_REPLACED,
  withheldHeading,
  withheldUnitMessage,
} from '../copy';
import type { CitedSlide } from '../ask/cited-slide';
import { SlideCard } from '../ask/SlideCard';
import { Empty, Failed, Pending } from '../shell/async-states';
import { WithheldDetails, WithheldItem } from '../shell/WithheldDetails';
import type { SummariesState } from './use-summaries';

type OnOpen = (cited: CitedSlide) => void;

/** A line's slides in citation order, each once, with the line's quotes from it; a slide the reply lacks is counted. */
const lineSlides = (
  unit: Unit,
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

const Sources = ({
  unit,
  slides,
  onOpen,
}: {
  readonly unit: Unit;
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => {
  const { cited, missing } = lineSlides(unit, slides);
  return cited.length === 0 && missing === 0 ? null : (
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
  );
};

type Shown = (
  digest: LectureDigest,
  slides: readonly RetrievedSlide[],
  onOpen: OnOpen,
) => ReactNode;

const lines: Shown = (digest, slides, onOpen) =>
  digest.units.length === 0 ? null : (
    <ol className="summary-lines">
      {digest.units.map((unit, index) => (
        <li key={index} className="summary-line">
          <p className="summary-line-text">{unit.text}</p>
          <Sources unit={unit} slides={slides} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );

const withheldUnits: Shown = (digest, slides, onOpen) =>
  digest.withheld.length === 0 ? null : (
    <ul>
      {digest.withheld.map((entry, index) => (
        <WithheldItem key={index} text={entry.unit.text} reason={withheldUnitMessage(entry)}>
          <Sources unit={entry.unit} slides={slides} onOpen={onOpen} />
        </WithheldItem>
      ))}
    </ul>
  );

/** The lecture's digest once read; `shown` returning `null` is a digest changed since the lectures were read. */
const DigestBody = ({
  lectureId,
  state,
  onLoad,
  onOpen,
  shown,
}: {
  readonly lectureId: LectureId;
  readonly state: SummariesState;
  readonly onLoad: () => void;
  readonly onOpen: OnOpen;
  readonly shown: Shown;
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
      const digest = value.summaries.find((candidate) => candidate.lectureId === lectureId);
      return (
        (digest === undefined ? null : shown(digest, value.slides, onOpen)) ?? (
          <Empty>{SUMMARY_REPLACED}</Empty>
        )
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
    <DigestBody lectureId={lectureId} state={state} onLoad={onLoad} onOpen={onOpen} shown={lines} />
  </details>
);

export const SummaryWithheld = ({
  lectureId,
  count,
  state,
  onLoad,
  onOpen,
}: {
  readonly lectureId: LectureId;
  readonly count: number;
  readonly state: SummariesState;
  readonly onLoad: () => void;
  readonly onOpen: OnOpen;
}) =>
  count === 0 ? null : (
    <WithheldDetails heading={withheldHeading(count)} onOpen={onLoad}>
      <DigestBody
        lectureId={lectureId}
        state={state}
        onLoad={onLoad}
        onOpen={onOpen}
        shown={withheldUnits}
      />
    </WithheldDetails>
  );

/**
 * A lecture with no summary and the act that makes one; `tried` is one this session could not make,
 * announced as that when `pressed`, and `withheld` one that kept no line. The button stays during a re-make.
 */
export const NoSummary = ({
  busy,
  tried,
  pressed,
  withheld,
  onRemake,
}: {
  readonly busy: boolean;
  readonly tried: boolean;
  readonly pressed: boolean;
  readonly withheld: boolean;
  readonly onRemake: () => void;
}) => {
  const resting = withheld ? SUMMARY_ALL_WITHHELD : tried ? SUMMARY_FAILED : NO_SUMMARY;
  return (
    <p className="lecture-summary-state" aria-busy={busy}>
      {busy ? (
        PENDING.remake
      ) : tried && pressed ? (
        <span role="alert">{SUMMARY_FAILED}</span>
      ) : (
        resting
      )}{' '}
      <button type="button" aria-disabled={busy} onClick={busy ? undefined : onRemake}>
        {MAKE_SUMMARY}
      </button>
    </p>
  );
};
