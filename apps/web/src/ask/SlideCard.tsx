import type { RetrievedSlide } from '@cram/shared';
import type { Ref } from 'react';
import { DERIVED_SOURCE } from '../copy';

/** A citation's slide, in the course's own terms: which lecture, which slide, its title. */
export const SlideCard = ({
  slide: { record },
  onOpen,
  ref,
}: {
  readonly slide: RetrievedSlide;
  readonly onOpen: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
}) => (
  <button ref={ref} type="button" className="slide-card" onClick={onOpen}>
    <span className="slide-card-lecture">{record.lectureTitle}</span>
    <span className="slide-card-number">Slide {record.slideNo}</span>
    {record.title.trim() !== '' && <span className="slide-card-title">{record.title}</span>}
    {record.derived && <span className="slide-card-derived">{DERIVED_SOURCE}</span>}
  </button>
);
