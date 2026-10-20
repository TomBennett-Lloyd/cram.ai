import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { SlideRecord, SourceId } from '@cram/shared';
import { z } from 'zod';

/**
 * The student's confirmations of derived text, keyed by source id so one outlives a re-upload;
 * it counts only while its hash is the slide's (`docs/adr/0006-image-only-slides.md` § Decision (g)).
 */
export const CONFIRMATION_TABLE = `
  create table confirmations (
    source_id text primary key,
    text_hash text not null,
    confirmed_at text not null
  ) strict;
`;

/**
 * The fields a quote resolves against (`@cram/grounding`'s `slideText`), as JSON so a field
 * boundary counts. The record's `derived` flag does not say which field was read from a picture.
 */
export const textHashOf = (
  record: Pick<SlideRecord, 'title' | 'body' | 'speakerNotes' | 'imageCaptions'>,
): string =>
  createHash('sha256')
    .update(JSON.stringify([record.title, record.body, record.speakerNotes, record.imageCaptions]))
    .digest('hex');

/** A `slides` row whose derived text has no confirmation of its current hash. */
export const UNCONFIRMED_DERIVED = `derived = 1 and not exists (
  select 1 from confirmations where confirmations.source_id = slides.source_id
    and confirmations.text_hash = slides.text_hash)`;

export type ConfirmResult =
  | { readonly status: 'confirmed' }
  | { readonly status: 'no-such-slide' | 'not-derived' | 'text-changed' };

export type ConfirmationState =
  | { readonly status: 'confirmed'; readonly confirmedAt: Date }
  | { readonly status: 'unconfirmed' | 'not-derived' | 'no-such-slide' };

const SlideHash = z.object({ derived: z.number(), text_hash: z.string() });
const ConfirmedAt = z.iso.datetime();

const slideHash = (db: Database, sourceId: SourceId) =>
  SlideHash.optional().parse(
    db.prepare('select derived, text_hash from slides where source_id = ?').get(sourceId),
  );

/** Records `seen`'s text as confirmed, refusing when the stored text is no longer what the student saw. */
export const confirmDerived = (
  db: Database,
  sourceId: SourceId,
  seen: SlideRecord,
  confirmedAt: Date,
): ConfirmResult => {
  const stored = slideHash(db, sourceId);
  if (stored === undefined) return { status: 'no-such-slide' };
  if (stored.derived !== 1) return { status: 'not-derived' };
  const seenHash = textHashOf(seen);
  if (seenHash !== stored.text_hash) return { status: 'text-changed' };
  db.prepare(
    `insert into confirmations (source_id, text_hash, confirmed_at) values (?, ?, ?)
       on conflict (source_id) do update set text_hash = excluded.text_hash, confirmed_at = excluded.confirmed_at`,
  ).run(sourceId, seenHash, confirmedAt.toISOString());
  return { status: 'confirmed' };
};

/** A confirmation whose hash is not the slide's reads as `unconfirmed`. */
export const confirmationState = (db: Database, sourceId: SourceId): ConfirmationState => {
  const stored = slideHash(db, sourceId);
  if (stored === undefined) return { status: 'no-such-slide' };
  if (stored.derived !== 1) return { status: 'not-derived' };
  const confirmedAt = ConfirmedAt.optional().parse(
    db
      .prepare('select confirmed_at from confirmations where source_id = ? and text_hash = ?')
      .pluck()
      .get(sourceId, stored.text_hash),
  );
  return confirmedAt === undefined
    ? { status: 'unconfirmed' }
    : { status: 'confirmed', confirmedAt: new Date(confirmedAt) };
};

/** Drops confirmations of slides the course no longer holds; the caller holds the transaction. */
export const dropOrphanConfirmations = (db: Database): void => {
  db.prepare(
    'delete from confirmations where source_id not in (select source_id from slides)',
  ).run();
};
