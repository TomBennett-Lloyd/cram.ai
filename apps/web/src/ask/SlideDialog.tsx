import { useEffect, useId, useRef } from 'react';
import { SLIDE_HAS_NO_TEXT } from '../copy';
import { Empty } from '../shell/async-states';
import type { CitedSlide } from './cited-slide';
import { type MarkedField, markedFields } from './quote-marks';

const FIELD_LABEL = { speakerNotes: 'Speaker notes', imageCaption: 'Image caption' } as const;

const FieldText = ({ field, segments }: MarkedField) => {
  const text = segments.map(({ text: run, marked }, index) =>
    marked ? <mark key={index}>{run}</mark> : run,
  );
  switch (field) {
    case 'title':
      return <h3 className="slide-title">{text}</h3>;
    case 'body':
      return <p className="slide-body">{text}</p>;
    case 'speakerNotes':
    case 'imageCaption':
      return (
        <div className="slide-aside">
          <h4>{FIELD_LABEL[field]}</h4>
          <p>{text}</p>
        </div>
      );
  }
};

/**
 * The cited slide's whole text with the unit's quotes marked, as a modal. Focus lands on the heading
 * and returns to the opener from the effect cleanup (`docs/standards/react.md`, the modal paragraph).
 */
export const SlideDialog = ({
  cited: { slide, quotes },
  onClose,
}: {
  readonly cited: CitedSlide;
  readonly onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    const opener = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    heading.current?.focus();
    return () => {
      // Closed first: while modal, the opener is inert and refuses focus (StrictMode's re-run, #16).
      node?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const { record } = slide;
  const fields = markedFields(record, quotes);
  return (
    <dialog
      ref={dialog}
      className="slide-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="slide-dialog-header">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {record.lectureTitle} · slide {record.slideNo}
        </h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {fields.length === 0 ? (
        <Empty>{SLIDE_HAS_NO_TEXT}</Empty>
      ) : (
        fields.map((field, index) => <FieldText key={index} {...field} />)
      )}
    </dialog>
  );
};
