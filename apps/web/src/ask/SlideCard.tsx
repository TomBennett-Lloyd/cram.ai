import type { RetrievedSlide } from '@cram/shared';

/** A citation's slide, in the course's own terms: which lecture, which slide, its title. */
export const SlideCard = ({
  slide: { record },
  onOpen,
}: {
  readonly slide: RetrievedSlide;
  readonly onOpen: () => void;
}) => (
  <button type="button" className="slide-card" onClick={onOpen}>
    <span className="slide-card-lecture">{record.lectureTitle}</span>
    <span className="slide-card-number">Slide {record.slideNo}</span>
    {record.title.trim() !== '' && <span className="slide-card-title">{record.title}</span>}
  </button>
);
