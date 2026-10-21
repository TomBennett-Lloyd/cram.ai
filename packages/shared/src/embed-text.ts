import { SLIDE_FIELD_SEPARATOR, slideFields } from './quotable-text';
import type { QuotableFields } from './slide-chunk';

/** The text ingest and the eval retriever embed a slide as (`.claude/ledgers/slide-embed-text.ledger`). */
export const embedText = (record: QuotableFields): string =>
  slideFields(record)
    .map(({ text }) => text)
    .join(SLIDE_FIELD_SEPARATOR);
