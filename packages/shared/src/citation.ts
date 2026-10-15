import { z } from 'zod';
import { NonBlankText } from './non-blank-text';

/** Names one source. How a slide's id is minted is ingest's and the index's (#10, #11). */
export const SourceId = z.string().min(1).brand<'SourceId'>();
export type SourceId = z.infer<typeof SourceId>;

/**
 * A verbatim span of one source's text (`docs/adr/0001-grounding-architecture.md`
 * § Decision (b)). A blank quote is refused: it is a substring of every source, so
 * resolution could never fail it.
 */
export const Citation = z.object({
  sourceId: SourceId,
  quote: NonBlankText,
});
export type Citation = z.infer<typeof Citation>;
