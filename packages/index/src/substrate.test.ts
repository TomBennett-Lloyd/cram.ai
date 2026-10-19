import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { describe, expect, it } from 'vitest';

// The named proof docs/adr/0004-storage.md § Decision (c) gives this package.
describe('retrieval substrate', () => {
  it('FTS5 and sqlite-vec load into a better-sqlite3 connection', () => {
    const db = new Database(':memory:');
    sqliteVec.load(db);
    db.exec("create virtual table probe_fts using fts5(body, content='', contentless_delete=1)");
    db.exec('create virtual table probe_vec using vec0(embedding float[2] distance_metric=cosine)');
    db.prepare('insert into probe_fts(rowid, body) values (?, ?)').run(1, 'mitochondria');
    db.prepare('insert into probe_vec(rowid, embedding) values (?, ?)').run(
      1n,
      new Float32Array([1, 0]),
    );

    expect(
      db.prepare('select rowid from probe_fts where probe_fts match ?').pluck().all('mitochondria'),
    ).toEqual([1]);
    expect(
      db
        .prepare('select rowid from probe_vec where embedding match ? and k = 1')
        .pluck()
        .all(new Float32Array([1, 0])),
    ).toEqual([1]);
    db.close();
  });
});
