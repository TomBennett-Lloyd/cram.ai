import {
  type LectureId,
  LectureSummary,
  type RetrievedSlide,
  type SlideRecord,
} from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { slide } from './course-fixture';
import { loadSummaries } from './loaded-summaries';
import { sourceIdOf } from './slide-row';

const retrieved = (record: SlideRecord): RetrievedSlide => ({
  sourceId: sourceIdOf(record),
  record,
});

const one = retrieved(slide({ slideNo: 1, body: 'Water crosses by osmosis.' }));
const two = retrieved(slide({ slideNo: 2, body: 'Solutes spread by diffusion.' }));
const three = retrieved(slide({ slideNo: 3, body: 'Cells divide.' }));
const enzymes = retrieved(
  slide({ lectureId: 'lecture-2', lectureTitle: 'Lecture 2', body: 'Enzymes speed reactions.' }),
);
const lipids = retrieved(
  slide({ lectureId: 'lecture-3', lectureTitle: 'Lecture 3', body: 'Lipids store energy.' }),
);

const summaryCiting = (...slides: readonly RetrievedSlide[]): LectureSummary => {
  const [first] = slides;
  if (first === undefined) throw new Error('summaryCiting: no slide');
  return LectureSummary.parse({
    lectureId: first.record.lectureId,
    units: slides.map(({ sourceId, record }) => ({
      text: `Summarised: ${record.body}`,
      citations: [{ sourceId, quote: record.body }],
      kind: 'lecture-summary',
    })),
  });
};

const course = (stored: readonly LectureSummary[], slides: readonly RetrievedSlide[]) => ({
  summary: (lectureId: LectureId) => stored.find((summary) => summary.lectureId === lectureId),
  lectureSlides: (lectureId: LectureId) =>
    slides.filter(({ record }) => record.lectureId === lectureId),
});

describe('loadSummaries', () => {
  const lecture1 = summaryCiting(one, three);
  const lecture2 = summaryCiting(enzymes);
  const lecture3 = summaryCiting(lipids);
  const stored = course([lecture1, lecture2, lecture3], [one, two, three, enzymes, lipids]);

  it('loads each ranked lecture’s summary once, in the rank of its best slide, with the slides it cites', () => {
    expect(loadSummaries(stored, [enzymes, two, one])).toEqual([
      { summary: lecture2, slides: [enzymes] },
      { summary: lecture1, slides: [one, three] },
    ]);
  });

  it('loads nothing for a lecture with no stored summary, or for no slide', () => {
    expect(loadSummaries(course([lecture2], [one, enzymes]), [one, enzymes])).toEqual([
      { summary: lecture2, slides: [enzymes] },
    ]);
    expect(loadSummaries(stored, [])).toEqual([]);
  });
});
