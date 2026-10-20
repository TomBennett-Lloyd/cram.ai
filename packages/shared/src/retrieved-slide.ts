import { z } from 'zod';
import { SourceId } from './citation';
import { SlideRecord } from './slide-record';

/** One slide in a call's retrieved set: what retrieval returns and what grounding cites from. */
export const RetrievedSlide = z.strictObject({ sourceId: SourceId, record: SlideRecord });
export type RetrievedSlide = z.infer<typeof RetrievedSlide>;
