import type { Explanation, RetrievedSlide, SourceId, VerificationDepth } from '@cram/shared';
import { Fragment, useRef } from 'react';
import {
  APPEARS_TO_CONTRADICT,
  ATTRIBUTED_NOTE,
  contradictionRefLabel,
  MAY_BE_RELEVANT,
  SOURCE_MISSING,
  sourceRefLabel,
  SUPPLEMENTARY,
  SUPPLEMENTARY_NOTE,
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

const derivedMark = (derived: boolean) => (derived ? '' : undefined);

/** A number that moves focus to its sources entry, which opens the slide. */
const SourceRef = ({ sourceId, refs }: { readonly sourceId: SourceId; readonly refs: Refs }) => {
  const found = refs.cite(sourceId);
  if (found === undefined) return <Missing />;
  return (
    <button
      type="button"
      className="source-ref"
      data-derived={derivedMark(found.cited.slide.record.derived)}
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
          data-derived={derivedMark(found.cited.slide.record.derived)}
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
        <q
          className="explanation-quote"
          data-derived={derivedMark(
            quote.sourceIds.some(
              (sourceId) => refs.cite(sourceId)?.cited.slide.record.derived === true,
            ),
          )}
        >
          {text}
        </q>
        {quote.ends &&
          quote.sourceIds.map((sourceId) => (
            <SourceRef key={sourceId} sourceId={sourceId} refs={refs} />
          ))}
      </Fragment>
    ),
  );
  const supplementary = sentence.standing === 'interpretation';
  return (
    <>
      {sentence.contradicts.length > 0 ? (
        <span className="contradicted">{words}</span>
      ) : supplementary ? (
        <span className="supplementary">{words}</span>
      ) : (
        words
      )}
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
      )}
      {supplementary && (
        <>
          {' '}
          <span className="supplementary-label">{SUPPLEMENTARY}</span>
        </>
      )}{' '}
    </>
  );
};

/**
 * One explanation (`docs/adr/0009-explanation-answers.md` § Decision (i)); at the deep
 * depth its reference label is the revision guide's.
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
      {explanation.sentences.some(({ standing }) => standing === 'interpretation') && (
        <p className="supplementary-note">{SUPPLEMENTARY_NOTE}</p>
      )}
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
