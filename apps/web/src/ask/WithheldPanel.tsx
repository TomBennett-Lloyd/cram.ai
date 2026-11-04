import type { RetrievedSlide, WithheldSentence } from '@cram/shared';
import {
  DROPPED_QUOTES_NOTE,
  type DroppedPointer,
  droppedQuotesHeading,
  SOURCE_MISSING,
  withheldHeading,
  withheldMessage,
} from '../copy';
import { WithheldDetails, WithheldItem } from '../shell/WithheldDetails';
import type { CitedSlide } from './cited-slide';
import { SlideCard } from './SlideCard';

type OnOpen = (cited: CitedSlide) => void;

const DroppedQuotes = ({
  dropped,
  slides,
  onOpen,
}: {
  readonly dropped: readonly DroppedPointer[];
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) =>
  dropped.length === 0 ? null : (
    <WithheldDetails heading={droppedQuotesHeading(dropped.length)}>
      <p className="withheld-reason">{DROPPED_QUOTES_NOTE}</p>
      <ul>
        {dropped.map((entry, index) => {
          const slide = slides.find(({ sourceId }) => sourceId === entry.sourceId);
          return (
            <li key={index}>
              <p className="withheld-text">{entry.text}</p>
              <ul className="citations">
                <li className={slide === undefined ? 'citation-missing' : undefined}>
                  {slide === undefined ? (
                    SOURCE_MISSING
                  ) : (
                    <SlideCard
                      slide={slide}
                      onOpen={() => {
                        onOpen({ slide, quotes: [] });
                      }}
                    />
                  )}
                </li>
              </ul>
            </li>
          );
        })}
      </ul>
    </WithheldDetails>
  );

export const WithheldPanel = ({
  withheld,
  slides,
  onOpen,
}: {
  readonly withheld: readonly WithheldSentence[];
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => {
  const dropped = withheld.flatMap((entry) =>
    entry.reason === 'dangling-citation' ? [entry] : [],
  );
  const cut = withheld.flatMap((entry) => (entry.reason === 'dangling-citation' ? [] : [entry]));
  return (
    <>
      <DroppedQuotes dropped={dropped} slides={slides} onOpen={onOpen} />
      {cut.length > 0 && (
        <WithheldDetails heading={withheldHeading(cut.length)}>
          <ul>
            {cut.map((entry, index) => (
              <WithheldItem key={index} text={entry.text} reason={withheldMessage(entry)} />
            ))}
          </ul>
        </WithheldDetails>
      )}
    </>
  );
};
