import { createHash } from 'node:crypto';
import { SCHEMA_VERSION } from '@cram/index';
import { describe, expect, it } from 'vitest';
import { storedOutputCorpus as corpus } from './stored-output-fixture';

/**
 * The corpus's records as a digest, under the schema it was recorded at; `sourceHash` enters only as whether it is
 * its deck's sha256, because the fixture bytes carry their build time. A course rebuilds through ingest only when
 * `SCHEMA_VERSION` moves (`docs/adr/0004-storage.md` § Decision (d); #257).
 */
const PIN = {
  schemaVersion: 7,
  digest: 'e3ea331c8cdd257c9603bb657281dc09743c54ce80da6c4436e34a1fdc91ef16',
};

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

describe('the records @cram/ingest stores', () => {
  it('are the ones SCHEMA_VERSION was cut for', async () => {
    const records = (await corpus()).flatMap(([bytes, slides]) =>
      slides.map((slide) => ({ ...slide, sourceHash: slide.sourceHash === sha256(bytes) })),
    );
    const live = { schemaVersion: SCHEMA_VERSION, digest: sha256(JSON.stringify(records)) };
    const advice =
      live.schemaVersion === PIN.schemaVersion
        ? `The corpus's records changed. If ingest's output changed, courses indexed earlier keep the old records until SCHEMA_VERSION in packages/index/src/schema.ts moves: bump it, then record its value and ${live.digest} as PIN. If only stored-output-fixture.ts changed, record ${live.digest} as PIN.`
        : `SCHEMA_VERSION moved: record ${JSON.stringify(live)} as PIN.`;
    expect(live, advice).toEqual(PIN);
  });
});
