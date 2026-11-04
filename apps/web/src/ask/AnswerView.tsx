import {
  type AskReply,
  type RetrievedSlide,
  type SourceId,
  VERIFICATION_DEPTH,
} from '@cram/shared';
import { CLOSEST_SLIDES, LEFT_OUT, MODEL_FAILED, NOT_COVERED, SEARCHED_FOR } from '../copy';
import { Failed } from '../shell/async-states';
import type { CitedSlide } from './cited-slide';
import { ExplanationView } from './ExplanationView';
import { SlideCard } from './SlideCard';
import { WithheldPanel } from './WithheldPanel';

type OnOpen = (cited: CitedSlide) => void;

const SlideCards = ({
  slides,
  onOpen,
}: {
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) => (
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
);

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
        <SlideCards slides={slides} onOpen={onOpen} />
      </>
    )}
  </>
);

const LeftOut = ({
  leftOut,
  slides,
  onOpen,
}: {
  readonly leftOut: readonly SourceId[];
  readonly slides: readonly RetrievedSlide[];
  readonly onOpen: OnOpen;
}) =>
  leftOut.length === 0 ? null : (
    <>
      <p className="left-out">{LEFT_OUT}</p>
      <SlideCards
        slides={slides.filter(({ sourceId }) => leftOut.includes(sourceId))}
        onOpen={onOpen}
      />
    </>
  );

const SearchedFor = ({ searched }: { readonly searched: string | undefined }) =>
  searched === undefined ? null : (
    <p className="searched">
      {SEARCHED_FOR} <q>{searched}</q>
    </p>
  );

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
          <ExplanationView
            explanation={reply.explanation}
            slides={reply.slides}
            depth={VERIFICATION_DEPTH.ask}
            onOpen={onOpen}
          />
          <LeftOut leftOut={reply.leftOut} slides={reply.slides} onOpen={onOpen} />
          <WithheldPanel withheld={reply.withheld} slides={reply.slides} onOpen={onOpen} />
        </>
      );
    case 'not-covered':
      return (
        <>
          <SearchedFor searched={reply.searched} />
          <ClosestSlides
            slides={reply.slides.filter(({ sourceId }) => !reply.leftOut.includes(sourceId))}
            onOpen={onOpen}
          />
          <LeftOut leftOut={reply.leftOut} slides={reply.slides} onOpen={onOpen} />
          <WithheldPanel withheld={reply.withheld} slides={reply.slides} onOpen={onOpen} />
        </>
      );
  }
};
