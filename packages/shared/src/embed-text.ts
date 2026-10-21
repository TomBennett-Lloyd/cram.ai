import { SLIDE_FIELD_SEPARATOR, slideFields } from './quotable-text';
import type { SlideRecord } from './slide-record';

/** The text ingest and the eval retriever embed a slide as (`.claude/ledgers/slide-embed-text.ledger`). */
export const embedText = (record: SlideRecord): string =>
  slideFields(record)
    .map(({ text }) => text)
    .join(SLIDE_FIELD_SEPARATOR);
