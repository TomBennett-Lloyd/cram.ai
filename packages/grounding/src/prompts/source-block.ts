import type { LoadedSummary, RetrievedSlide } from '@cram/shared';
import { slideLines } from '../slide-text';

/** A retrieved slide as every generation prompt shows it: its id, then its lines one to a row (#367, #481). */
export const sourceBlock = (slide: RetrievedSlide): string => {
  const rows = slideLines(slide.record).join('\n');
  return `<source id="${slide.sourceId}">\n${rows}\n</source>`;
};

export const summaryBlock = ({ summary }: LoadedSummary): string => {
  const rows = summary.units.map(({ text }) => `- ${text}`);
  return `<summary lecture="${summary.lectureId}">\n${rows.join('\n')}\n</summary>`;
};
