import { createHash } from 'node:crypto';
import { SCHEMA_VERSION } from '@cram/index';
import { describe, expect, it } from 'vitest';
import { storedOutputCorpus as corpus } from './stored-output-fixture';

/**
 * The corpus's records as a digest, under the schema it was recorded at; `sourceHash` is left out because the
 * fixture bytes carry their build time. A course rebuilds through ingest only when `SCHEMA_VERSION` moves
 * (`docs/adr/0004-storage.md` § Decision (d)), so a new digest is recorded only beside a bump (#257).
 */
const PIN = {
  schemaVersion: 5,
  digest: 'd40d1aab3e310b6c3d51562408012180f17e33468df649095c1fa6dd9b68bd06',
};

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

describe('the records @cram/ingest stores', () => {
  it('are the ones SCHEMA_VERSION was cut for', async () => {
    const records = (await corpus()).flatMap(([, slides]) => slides);
    const stored = JSON.stringify(records, (key, value: unknown) =>
      key === 'sourceHash' ? undefined : value,
    );
    const live = { schemaVersion: SCHEMA_VERSION, digest: sha256(stored) };
    const advice =
      live.digest === PIN.digest
        ? `SCHEMA_VERSION moved: record ${JSON.stringify(live)} as PIN.`
        : `The stored records changed, so courses indexed earlier keep the old ones until SCHEMA_VERSION in packages/index/src/schema.ts moves: bump it in this change, then record its value and ${live.digest} as PIN.`;
    expect(live, advice).toEqual(PIN);
  });

  it("carry the sha256 of their deck's bytes as sourceHash", async () => {
    for (const [bytes, slides] of await corpus())
      for (const { sourceHash } of slides) expect(sourceHash).toBe(sha256(bytes));
  });
});
