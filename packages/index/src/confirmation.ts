import { createHash } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { type SlideRecord, slideFields, type SourceId } from '@cram/shared';
import { z } from 'zod';

/** Confirmations of derived text; its ledger: `.claude/ledgers/confirmations-table.ledger`. */
export const CONFIRMATION_TABLE = `
  create table confirmations (
    source_id text primary key,
    text_hash text not null,
    confirmed_at text not null
  ) strict;
`;

export const textHashOf = (record: SlideRecord): string =>
  createHash('sha256')
    .update(JSON.stringify(slideFields(record)))
    .digest('hex');

/** A `slides` row whose derived text has no confirmation. */
export const UNCONFIRMED_DERIVED = `derived = 1 and not exists (
  select 1 from confirmations where confirmations.source_id = slides.source_id)`;

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
    'insert or replace into confirmations (source_id, text_hash, confirmed_at) values (?, ?, ?)',
  ).run(sourceId, seenHash, confirmedAt.toISOString());
  return { status: 'confirmed' };
};

export const confirmationState = (db: Database, sourceId: SourceId): ConfirmationState => {
  const stored = slideHash(db, sourceId);
  if (stored === undefined) return { status: 'no-such-slide' };
  if (stored.derived !== 1) return { status: 'not-derived' };
  const confirmedAt = ConfirmedAt.optional().parse(
    db.prepare('select confirmed_at from confirmations where source_id = ?').pluck().get(sourceId),
  );
  return confirmedAt === undefined
    ? { status: 'unconfirmed' }
    : { status: 'confirmed', confirmedAt: new Date(confirmedAt) };
};

/** Drops each confirmation whose slide is gone or whose text has changed; the caller holds the transaction. */
export const dropVoidConfirmations = (db: Database): void => {
  db.prepare(
    `delete from confirmations where not exists (select 1 from slides
       where slides.source_id = confirmations.source_id and slides.text_hash = confirmations.text_hash)`,
  ).run();
};
