import { describe, expect, it } from 'vitest';
import { Upload } from './ingest-status';

const upload = { uploadId: 'u1', lectureId: 'l1', fileName: 'hive.pdf' };

describe('Upload', () => {
  it('reports image-only pages by slide number, counted from 1', () => {
    const indexed = { ...upload, state: 'indexed', slideCount: 2 };
    expect(Upload.safeParse({ ...indexed, imageOnly: [2] }).success).toBe(true);
    expect(Upload.safeParse({ ...indexed, imageOnly: [0] }).success).toBe(false);
  });

  it('refuses a state that is not an ingest stage', () => {
    expect(Upload.safeParse({ ...upload, state: 'queued' }).success).toBe(true);
    expect(Upload.safeParse({ ...upload, state: 'done' }).success).toBe(false);
  });
});
