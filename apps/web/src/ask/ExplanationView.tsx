import type { Explanation, RetrievedSlide, SourceId, VerificationDepth } from '@cram/shared';
import { Fragment, useRef } from 'react';
import {
  APPEARS_TO_CONTRADICT,
  ATTRIBUTED_NOTE,
  contradictionRefLabel,
  MAY_BE_RELEVANT,
  SOURCE_MISSING,
  sourceRefLabel,
} from '../copy';
import { type CitedSlide, citedSlide } from './cited-slide';
import {
  type MarkedSentence,
  markExplanation,
  paragraphsOf,
  sourceNumbers,
} from './explanation-marks';
import { SourcesList } from './SourcesList';

type OnOpen = (cited: CitedSlide) => void;

interface Refs {
  readonly cite: (
    sourceId: SourceId,
  ) => { readonly cited: CitedSlide; readonly number: number } | undefined;
  readonly jump: (sourceId: SourceId) => void;
  readonly onOpen: OnOpen;
}

const Missing = () => <span className="citation-missing">{SOURCE_MISSING}</span>;

/** A number that moves focus to its sources entry, which opens the slide. */
const SourceRef = ({ sourceId, refs }: { readonly sourceId: SourceId; readonly refs: Refs }) => {
  const found = refs.cite(sourceId);
  if (found === undefined) return <Missing />;
  return (
    <button
      type="button"
      className="source-ref"
      aria-label={sourceRefLabel(found.number, found.cited.slide.record)}
      onClick={() => {
        refs.jump(sourceId);
      }}
    >
      {found.number}
    </button>
  );
};

const ContradictionRefs = ({
  sentence,
  refs,
}: {
  readonly sentence: MarkedSentence;
  readonly refs: Refs;
}) => (
  <span className="contradiction-refs">
    {sentence.contradicts.map((sourceId) => {
      const found = refs.cite(sourceId);
      return found === undefined ? (
        <Missing key={sourceId} />
      ) : (
        <button
          key={sourceId}
          type="button"
          className="source-ref"
          aria-label={contradictionRefLabel(found.number, found.cited.slide.record)}
          onClick={() => {
            refs.onOpen({ ...found.cited, contradicted: sentence.text });
          }}
        >
          {found.number}
        </button>
      );
    })}
    <span className="contradiction-label" aria-hidden="true">
      {APPEARS_TO_CONTRADICT}
    </span>
  </span>
);

const SentenceView = ({
  sentence,
  depth,
  refs,
}: {
  readonly sentence: MarkedSentence;
  readonly depth: VerificationDepth;
  readonly refs: Refs;
}) => {
  const words = sentence.runs.map(({ text, quote }, index) =>
    quote === undefined ? (
      <Fragment key={index}>{text}</Fragment>
    ) : (
      <Fragment key={index}>
        <q className="explanation-quote">{text}</q>
        {quote.ends &&
          quote.sourceIds.map((sourceId) => (
            <SourceRef key={sourceId} sourceId={sourceId} refs={refs} />
          ))}
      </Fragment>
    ),
  );
  return (
    <>
      {sentence.contradicts.length === 0 ? words : <span className="contradicted">{words}</span>}
      {sentence.contradicts.length > 0 && (
        <>
          {' '}
          <ContradictionRefs sentence={sentence} refs={refs} />
        </>
      )}
      {sentence.mayBeRelevant.length > 0 && (
        <>
          {' '}
          <span className="sentence-refs">
            {depth === 'light' && <span className="sentence-refs-label">{MAY_BE_RELEVANT}</span>}
            {sentence.mayBeRelevant.map((sourceId) => (
              <SourceRef key={sourceId} sourceId={sourceId} refs={refs} />
            ))}
          </span>
        </>
      )}{' '}
    </>
  );
};

/**
 * One explanation: its sentences with their marks and numbers, the attributed note at the light
 * depth, and the sources list (`docs/adr/0009-explanation-answers.md` § Decision (i)). The deep
 * depth's reference label is the revision guide's.
 */
export const ExplanationView = ({
  explanation,
  slides,
  depth,
  onOpen,
}: {
  readonly explanation: Explanation;
  readonly slides: readonly RetrievedSlide[];
  readonly depth: VerificationDepth;
  readonly onOpen: OnOpen;
}) => {
  const entries = useRef(new Map<SourceId, HTMLButtonElement>());
  const numbers = sourceNumbers(explanation.sources);
  const refs: Refs = {
    cite: (sourceId) => {
      const cited = citedSlide(sourceId, explanation.quotes, slides);
      const number = numbers.get(sourceId);
      return cited === undefined || number === undefined ? undefined : { cited, number };
    },
    jump: (sourceId) => entries.current.get(sourceId)?.focus(),
    onOpen,
  };
  return (
    <div className="explanation">
      <div className="explanation-text">
        {paragraphsOf(markExplanation(explanation)).map((paragraph, at) => (
          <p key={at}>
            {paragraph.map((sentence, index) => (
              <SentenceView key={index} sentence={sentence} depth={depth} refs={refs} />
            ))}
          </p>
        ))}
      </div>
      {depth === 'light' && <p className="attributed-note">{ATTRIBUTED_NOTE}</p>}
      <SourcesList
        sources={explanation.sources}
        cite={(sourceId) => citedSlide(sourceId, explanation.quotes, slides)}
        entries={entries}
        onOpen={onOpen}
      />
    </div>
  );
};
