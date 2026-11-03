import Database from 'better-sqlite3';
import { z } from 'zod';

/** A word as `slides_fts` cuts it: the `typed` span of the text from `start`, and the `term` the index stores for it. */
export interface IndexWord {
  readonly typed: string;
  readonly start: number;
  readonly term: string;
}

interface CodePointRole {
  readonly starts: boolean;
  readonly continues: boolean;
  readonly folded: string;
}

interface OpenWord {
  readonly start: number;
  end: number;
  term: string;
}

const ProbeRows = z.array(z.object({ doc: z.number().int(), term: z.string() }));

/** No `tokenize` option, as `slides_fts` declares none in `schema.ts`; `index-words.test.ts` holds the two equal. */
const PROBE_TABLES = `
  create virtual table probe using fts5(t);
  create virtual table probe_terms using fts5vocab(probe, instance);
`;

/** Words as FTS5 cuts and folds them, asked of FTS5 one code point at a time on a side connection (#489). */
export class IndexTokenizer {
  readonly #roles = new Map<string, CodePointRole>();
  #probe: Database.Database | undefined;

  #learn(codePoints: readonly string[]): void {
    if (this.#probe === undefined) {
      this.#probe = new Database(':memory:');
      this.#probe.exec(PROBE_TABLES);
    }
    const probe = this.#probe;
    const insert = probe.prepare('insert into probe (rowid, t) values (?, ?)');
    probe.transaction(() => {
      codePoints.forEach((codePoint, index) => {
        insert.run(2 * index + 1, codePoint);
        insert.run(2 * index + 2, `a${codePoint}a`);
      });
    })();
    try {
      const termsOf = new Map<number, string[]>();
      for (const { doc, term } of ProbeRows.parse(
        probe.prepare('select doc, term from probe_terms order by doc, offset').all(),
      ))
        termsOf.set(doc, [...(termsOf.get(doc) ?? []), term]);
      codePoints.forEach((codePoint, index) => {
        const [joined, ...split] = termsOf.get(2 * index + 2) ?? [];
        const continues = joined !== undefined && split.length === 0;
        this.#roles.set(codePoint, {
          starts: termsOf.has(2 * index + 1),
          continues,
          folded: continues ? joined.slice(1, -1) : '',
        });
      });
    } finally {
      probe.prepare('delete from probe').run();
    }
  }

  #roleOf(codePoint: string): CodePointRole {
    const role = this.#roles.get(codePoint);
    if (role === undefined)
      throw new Error(`IndexTokenizer: ${JSON.stringify(codePoint)} was never probed`);
    return role;
  }

  words(text: string): readonly IndexWord[] {
    this.#learn([...new Set(text)].filter((codePoint) => !this.#roles.has(codePoint)));
    const open: OpenWord[] = [];
    let offset = 0;
    for (const codePoint of text) {
      const role = this.#roleOf(codePoint);
      const end = offset + codePoint.length;
      const last = open.at(-1);
      if (last?.end === offset && role.continues) {
        last.end = end;
        last.term += role.folded;
      } else if (role.starts) open.push({ start: offset, end, term: role.folded });
      offset = end;
    }
    return open.map(({ start, end, term }) => ({ typed: text.slice(start, end), start, term }));
  }
}

/** The one word model behind search quoting, spelling correction and topic matching. */
export const INDEX_WORDS = new IndexTokenizer();
