import type { AskReply, RetrievedSlide, Unit } from '@cram/shared';
import { CLOSEST_SLIDES, MODEL_FAILED, NOT_COVERED, SEARCHED_FOR, SOURCE_MISSING } from '../copy';
import { Failed } from '../shell/async-states';
import { type CitedSlide, citedSlides } from './cited-slide';
import { SlideCard } from './SlideCard';
import { WithheldPanel } from './WithheldPanel';

type OnOpen = (cited: CitedSlide) => void;

const UnitView = ({
  unit,
  slides,
  onOpen,
}: {
  readonly unit: Unit;
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => {
  const { cited, missing } = citedSlides(unit.citations, slides);
  return (
    <li className="unit">
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
};

const ClosestSlides = ({
  slides,
  onOpen,
}: {
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => (
  <>
    <p className="not-covered">{NOT_COVERED}</p>
    {slides.length > 0 && (
      <>
        <h2 className="closest-heading">{CLOSEST_SLIDES}</h2>
        <ul className="citations">
          {slides.map((slide) => (
            <li key={slide.sourceId}>
              <SlideCard
                slide={slide}
                onOpen={() => {
                  onOpen({ slide, quotes: [] });
                }}
              />
            </li>
          ))}
        </ul>
      </>
    )}
  </>
);

const SearchedFor = ({ searched }: { readonly searched: string | undefined }) =>
  searched === undefined ? null : (
    <p className="searched">
      {SEARCHED_FOR} <q>{searched}</q>
    </p>
  );

/** One reply: the answer's units with their slides, or the not-covered result, and what was withheld. */
export const AnswerView = ({
  reply,
  onOpen,
}: {
  readonly reply: AskReply;
  readonly onOpen: OnOpen;
}) => {
  switch (reply.status) {
    case 'model-failed':
      return <Failed messages={[MODEL_FAILED]} />;
    case 'grounded':
      return (
        <>
          <SearchedFor searched={reply.searched} />
          <ol className="answer">
            {reply.shown.map((unit, index) => (
              <UnitView key={index} unit={unit} slides={reply.slides} onOpen={onOpen} />
            ))}
          </ol>
          <WithheldPanel withheld={reply.withheld} />
        </>
      );
    case 'not-covered':
      return (
        <>
          <SearchedFor searched={reply.searched} />
          <ClosestSlides slides={reply.slides} onOpen={onOpen} />
          <WithheldPanel withheld={reply.withheld} />
        </>
      );
  }
};
