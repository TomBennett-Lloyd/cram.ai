import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TopicTag } from '@cram/shared';
import { COURSE, deck, EMBEDDER, firstFact, indexed, slide, vector } from './course-fixture';
import { CourseIndex } from './course-index';
import type { SearchQuery } from './search-query';
import { createSchema } from './schema';
import { sourceIdOf } from './slide-row';

// A plan, not a timing, so the gate holds on a loaded machine (#136, #152).
const PlanRow = z.object({ detail: z.string() });
const VIRTUAL_TABLE_SCAN = /^SCAN (\w+).*? VIRTUAL TABLE INDEX \d+:(.*)$/;

interface VirtualTableScan {
  readonly table: string;
  readonly indexString: string;
}

/** Every virtual-table scan in the plans of the statements `search` prepares for `query`, over one fact tagged with a topic it names. */
const virtualTableScans = (query: SearchQuery): readonly VirtualTableScan[] => {
  const db = new Database(':memory:');
  try {
    sqliteVec.load(db);
    createSchema(db, COURSE, EMBEDDER);
    const course = new CourseIndex(db, COURSE, EMBEDDER);
    const tagged = slide({ body: 'water' });
    course.replaceLecture(deck(), [], [indexed(tagged, vector(1, 0, 0, 0))]);
    course.setTopics(firstFact(sourceIdOf(tagged)), 'tagger', [TopicTag.parse('osmosis')]);
    const prepare = vi.spyOn(db, 'prepare');
    course.search(query);
    const prepared = prepare.mock.calls.map(([sql]) => sql);
    prepare.mockRestore();
    return prepared.flatMap((sql) => {
      const unbound = Array.from(sql.matchAll(/\?/g), () => null);
      return db
        .prepare(`explain query plan ${sql}`)
        .all(...unbound)
        .flatMap((row) => {
          const scan = VIRTUAL_TABLE_SCAN.exec(PlanRow.parse(row).detail);
          return scan?.[1] === undefined || scan[2] === undefined
            ? []
            : [{ table: scan[1], indexString: scan[2] }];
        });
    });
  } finally {
    db.close();
  }
};

const QUERIES = [false, true].flatMap((includeReferences) =>
  [false, true].map((excludeUnconfirmedDerived) => ({
    text: 'osmosis membrane',
    embedding: vector(1, 0, 0, 0),
    includeReferences,
    excludeUnconfirmedDerived,
  })),
);

describe.each(QUERIES)(
  'CourseIndex.search plans with includeReferences=$includeReferences, excludeUnconfirmedDerived=$excludeUnconfirmedDerived',
  (query) => {
    it('scan the word index once and the vector index once', () => {
      expect(
        virtualTableScans(query)
          .map((scan) => scan.table)
          .sort(),
      ).toEqual(['slide_vec', 'slides_fts']);
    });

    it('hand FTS5 no rowid equality, which it answers by running MATCH once per id (#78)', () => {
      const words = virtualTableScans(query).filter((scan) => scan.table === 'slides_fts');
      expect(words.map((scan) => scan.indexString.includes('='))).toEqual([false]);
    });
  },
);
