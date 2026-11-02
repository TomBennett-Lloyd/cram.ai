import type { RetrievedSlide } from '@cram/shared';
import { slideLines } from '../slide-text';

/** A retrieved slide as every generation prompt shows it: its id, then its lines numbered from 1 (#367). */
export const sourceBlock = (slide: RetrievedSlide): string => {
  const rows = slideLines(slide.record).map((line, index) => `[${String(index + 1)}] ${line}`);
  return `<source id="${slide.sourceId}">\n${rows.join('\n')}\n</source>`;
};
