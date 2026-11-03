import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  indexed,
  indexLectures,
  openOrFail,
  slide,
  tempCourse,
  vector,
  type TempCourse,
} from './course-fixture';
import { INDEX_WORDS, IndexTokenizer } from './index-words';

let temp: TempCourse;
beforeEach(() => {
  temp = tempCourse();
});
afterEach(() => {
  temp.remove();
});

// Spacing marks (Mc), enclosing marks (Me), dotted capitals, NFC/NFD pairs, then near-misses of each.
const NAMED = [
  'किताब',
  'क ताब',
  'abcdःefgh',
  'কাl',
  'क्षमा',
  'tree⃞house',
  '1⃣ keycap',
  '҈x',
  'İstanbul',
  'ISTANBUL istanbul',
  'ı dotless',
  'i̇stanbul',
  'naïve',
  'naïve',
  'café',
  'café',
  '́leading mark',
  'é́clair',
  'Å Å Å',
  'Ω Ω',
  'straße STRASSE',
  'ﬁne',
  'well-known can’t',
  'NEAR("a" b) AND -c* ^d',
  'x2 1,500 ²',
  '蜜蜂と巣',
  '🐝 comb 👍🏽',
  'zero‍width soft­hyphen word⁠joiner',
  'Σίσυφος ς',
  'ǅemal Ⅻ',
  '𝔞𝔟𝔠',
  'a\0b',
  'a\ud800b \udc00',
  'x \u{f0000}',
  '͸x \u{1fae8}',
  'snake_case',
  '',
  '?! -- "" ()',
];

const HOSTILE_ALPHABET = [
  ...['a', 'Z', '0', '9', ' ', '-', '_', '.', ',', '"', "'", '*', '(', ')', '^', ':', '\t', '\n'],
  ...['İ', 'ı', 'ß', 'É', 'é', '́', '̈', '̱', '̲', '̧', 'ً'],
  ...['ः', 'ि', '्', 'क', '⃝', '҈', '‍', '­', '​'],
  ...['糖', '😀', '\u{e000}', '͸', '�', '\ud800', '\0', 'Ａ', 'ﬁ', 'Σ', 'ς', 'ά', 'ǅ'],
];

/** Seeded, so a failure names the same strings every run. */
const hostileStrings = (count: number): readonly string[] => {
  let seed = 489;
  const next = (below: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % below;
  };
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 1 + next(10) },
      () => HOSTILE_ALPHABET[next(HOSTILE_ALPHABET.length)] ?? '',
    ).join(''),
  );
};

/** Every BMP scalar value alone and between two letters, the two probes `IndexTokenizer` asks of each. */
const everyBmpCodePoint = (): string => {
  const parts: string[] = [];
  for (let code = 0; code <= 0xffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const codePoint = String.fromCodePoint(code);
    parts.push(codePoint, `a${codePoint}a`);
  }
  return parts.join(' ');
};

const OracleRow = z.object({ doc: z.number(), term: z.string() });
const ChunkSlide = z.object({ id: z.number(), slideNo: z.number() });

/** The terms `slides_fts` stores for each slide's body, in order, read through `fts5vocab` on the course file. */
const indexedTerms = (bodies: readonly string[]): ReadonlyMap<number, readonly string[]> => {
  const course = openOrFail(temp.spec);
  indexLectures(
    course,
    bodies.map((body, index) => indexed(slide({ slideNo: index + 1, body }), vector(1, 0, 0, 0))),
  );
  course.close();
  const db = new Database(temp.spec.path);
  try {
    db.exec('create virtual table temp.oracle using fts5vocab(main, slides_fts, instance)');
    const slideOf = new Map(
      z
        .array(ChunkSlide)
        .parse(
          db
            .prepare(
              'select chunks.id, slides.slide_no as slideNo from chunks join slides on slides.id = chunks.slide_id',
            )
            .all(),
        )
        .map(({ id, slideNo }) => [id, slideNo]),
    );
    const rows = z
      .array(OracleRow)
      .parse(
        db.prepare("select doc, term from oracle where col = 'body' order by doc, offset").all(),
      );
    const terms = new Map<number, string[]>();
    for (const { doc, term } of rows) {
      const slideNo = slideOf.get(doc) ?? 0;
      const held = terms.get(slideNo) ?? [];
      held.push(term);
      terms.set(slideNo, held);
    }
    return terms;
  } finally {
    db.close();
  }
};

const disagreements = (words: IndexTokenizer, bodies: readonly string[]): readonly string[] => {
  const oracle = indexedTerms(bodies);
  return bodies.flatMap((body, index) => {
    const ours = words.words(body).map(({ term }) => term);
    const theirs = oracle.get(index + 1) ?? [];
    return JSON.stringify(ours) === JSON.stringify(theirs)
      ? []
      : [`${JSON.stringify(body)}: ${JSON.stringify(ours)} vs ${JSON.stringify(theirs)}`];
  });
};

describe('IndexTokenizer.words', () => {
  it('cuts and folds as slides_fts does: spacing and enclosing marks, dotted capitals, NFC/NFD', () => {
    expect(disagreements(INDEX_WORDS, NAMED)).toEqual([]);
  });

  it('cuts and folds as slides_fts does over a seeded hostile corpus', () => {
    expect(disagreements(INDEX_WORDS, hostileStrings(600))).toEqual([]);
  });

  it('treats every BMP code point as slides_fts does', () => {
    expect(disagreements(new IndexTokenizer(), [everyBmpCodePoint()])).toEqual([]);
  });

  it('gives each word the span it was typed as, and leaves no word outside the spans', () => {
    for (const text of [...NAMED, ...hostileStrings(200)]) {
      const words = INDEX_WORDS.words(text);
      let gaps = '';
      let from = 0;
      for (const { typed, start, term } of words) {
        expect(text.slice(start, start + typed.length), JSON.stringify(text)).toBe(typed);
        expect(INDEX_WORDS.words(typed), JSON.stringify(typed)).toEqual([
          { typed, start: 0, term },
        ]);
        gaps += text.slice(from, start);
        from = start + typed.length;
      }
      expect(INDEX_WORDS.words(gaps + text.slice(from)), JSON.stringify(text)).toEqual([]);
    }
  });
});
