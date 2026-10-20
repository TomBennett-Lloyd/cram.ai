import type { Database } from 'better-sqlite3';
import {
  SlideKind,
  type CourseId,
  type Deck,
  type LectureId,
  type SlideImage,
  type SlideNo,
  type SlideRecord,
  type SourceId,
} from '@cram/shared';
import { z } from 'zod';
import type { EmbedderIdentity } from './embedder-identity';
import { ftsMatchExpression } from './fts-query';
import { fuseByReciprocalRank } from './reciprocal-rank';
import { createVectorTable } from './schema';
import {
  ftsValues,
  SLIDE_COLUMNS,
  slideFromRow,
  slideRowValues,
  sourceIdOf,
  type StoredSlide,
} from './slide-row';
import {
  deleteDeck,
  readDeck,
  readSlideImage,
  requireDistinctSlideImages,
  writeDeck,
} from './stored-deck';

/** Slides `search` returns by default; provisional until recall@k against the eval deck tunes it (#69). */
export const RETRIEVAL_K = 8;

/** Depth of each ranked list fed to fusion; provisional on the same terms as `RETRIEVAL_K`. */
export const CANDIDATES_PER_LIST = 50;

export interface IndexedSlide {
  readonly record: SlideRecord;
  readonly embedding: Float32Array;
}

export interface SearchQuery {
  readonly text: string;
  readonly embedding: Float32Array;
  /** Off by default: references pages would dominate BM25 (#9's sizing comment, #78). */
  readonly includeReferences?: boolean;
}

export interface SearchHit {
  readonly sourceId: SourceId;
  readonly record: SlideRecord;
}

export type SetTopicsResult = { readonly status: 'set' } | { readonly status: 'no-such-slide' };

export type RemoveLectureResult =
  { readonly status: 'removed' } | { readonly status: 'no-such-lecture' };

const RowId = z.number().int();
const RowIds = z.array(RowId);

const requireDimension = (
  operation: string,
  embedding: Float32Array,
  embedder: EmbedderIdentity,
): void => {
  if (embedding.length !== embedder.dimension) {
    throw new Error(
      `${operation}: embedding has ${String(embedding.length)} dimensions; ${embedder.model} has ${String(embedder.dimension)}`,
    );
  }
};

const REFERENCES = `'${SlideKind.enum.references}'`;

/**
 * Each list's references filter. vec0 drops rows before `k` only for `rowid in`; FTS5 given
 * `rowid in` re-runs its MATCH once per id, so it takes `not in` (#78's PR, `retrieval.measure.test.ts`).
 */
const WITHOUT_REFERENCES = {
  bm25: `and rowid not in (select id from slides where kind = ${REFERENCES})`,
  vector: `and rowid in (select id from slides where kind <> ${REFERENCES})`,
} as const;

const INSERT_SLIDE = `insert into slides (${SLIDE_COLUMNS}) values (${SLIDE_COLUMNS.replace(/\w+/g, '?')}) returning id`;

/** One open course file (`docs/adr/0004-storage.md`). */
export class CourseIndex {
  readonly #db: Database;
  readonly #courseId: CourseId;
  #embedder: EmbedderIdentity;

  constructor(db: Database, courseId: CourseId, embedder: EmbedderIdentity) {
    this.#db = db;
    this.#courseId = courseId;
    this.#embedder = embedder;
  }

  #dropIndexRows(id: number): void {
    this.#db.prepare('delete from slides_fts where rowid = ?').run(id);
    this.#db.prepare('delete from slide_vec where rowid = ?').run(BigInt(id));
  }

  #writeVector(id: number, embedding: Float32Array): void {
    this.#db
      .prepare('insert into slide_vec (rowid, embedding) values (?, ?)')
      .run(BigInt(id), embedding);
  }

  /** Refuses a batch before anything is written. */
  #checkBatch(operation: string, slides: readonly IndexedSlide[]): void {
    const seen = new Set<SourceId>();
    for (const { record, embedding } of slides) {
      const sourceId = sourceIdOf(record);
      if (record.courseId !== this.#courseId) {
        throw new Error(
          `${operation}: ${sourceId} belongs to course ${record.courseId}, not ${this.#courseId}`,
        );
      }
      if (seen.has(sourceId))
        throw new Error(`${operation}: ${sourceId} appears twice in one batch`);
      seen.add(sourceId);
      requireDimension(`${operation}(${sourceId})`, embedding, this.#embedder);
    }
  }

  /** Text and vector together; the caller holds the transaction and has dropped the lecture's rows. */
  #writeSlides(slides: readonly IndexedSlide[]): void {
    const insert = this.#db.prepare(INSERT_SLIDE).pluck();
    const writeText = this.#db.prepare(
      'insert into slides_fts (rowid, lecture_title, title, body, speaker_notes, image_captions) values (?, ?, ?, ?, ?, ?)',
    );
    for (const { record, embedding } of slides) {
      const id = RowId.parse(insert.get(...slideRowValues(record)));
      writeText.run(id, ...ftsValues(record));
      this.#writeVector(id, embedding);
    }
  }

  /** Deletes the lecture's slides and every index and tag row keyed on them; the caller holds the transaction. */
  #dropLectureSlides(lectureId: LectureId): void {
    const ids = RowIds.parse(
      this.#db.prepare('select id from slides where lecture_id = ?').pluck().all(lectureId),
    );
    this.#db
      .prepare('delete from topics where slide_id in (select id from slides where lecture_id = ?)')
      .run(lectureId);
    for (const id of ids) this.#dropIndexRows(id);
    this.#db.prepare('delete from slides where lecture_id = ?').run(lectureId);
  }

  /**
   * Replaces the lecture's deck, slide images and slides in one transaction, so a re-uploaded deck
   * with fewer slides leaves none of the old ones behind (#71). Topic tags go with the old slides.
   * The only slide write, so every slide has a stored deck to rebuild from (rebuild-course.ts, #93).
   */
  replaceLecture(deck: Deck, images: readonly SlideImage[], slides: readonly IndexedSlide[]): void {
    this.#checkBatch('replaceLecture', slides);
    requireDistinctSlideImages('replaceLecture', deck.lectureId, images);
    for (const { record } of slides) {
      if (record.lectureId !== deck.lectureId)
        throw new Error(
          `replaceLecture: ${sourceIdOf(record)} is not in lecture ${deck.lectureId}`,
        );
    }
    this.#db.transaction(() => {
      this.#dropLectureSlides(deck.lectureId);
      writeDeck(this.#db, deck, images);
      this.#writeSlides(slides);
    })();
  }

  /** Deletes the lecture's slides, deck and slide images in one transaction, so no rebuild brings it back. */
  removeLecture(lectureId: LectureId): RemoveLectureResult {
    const removed = this.#db.transaction(() => {
      this.#dropLectureSlides(lectureId);
      return deleteDeck(this.#db, lectureId);
    })();
    return removed ? { status: 'removed' } : { status: 'no-such-lecture' };
  }

  #storedSlides(where: string, ...params: readonly (string | number)[]): readonly StoredSlide[] {
    return this.#db
      .prepare(`select id, ${SLIDE_COLUMNS} from slides ${where}`)
      .all(...params)
      .map((row) => slideFromRow(row, this.#courseId));
  }

  /** Every slide in the course, by lecture then slide number. */
  slides(): readonly SlideRecord[] {
    return this.#storedSlides('order by lecture_id, slide_no').map((slide) => slide.record);
  }

  /**
   * BM25 and vector candidates fused by reciprocal rank (`docs/adr/0004-storage.md` § Decision (c)), best first.
   * Each list leaves references slides out before it is cut to depth, unless the query includes them.
   */
  search(query: SearchQuery, k: number = RETRIEVAL_K): readonly SearchHit[] {
    if (!Number.isInteger(k) || k < 1)
      throw new Error(`search: k must be a positive integer, got ${String(k)}`);
    requireDimension('search', query.embedding, this.#embedder);
    const depth = Math.max(k, CANDIDATES_PER_LIST);
    const filter = query.includeReferences === true ? { bm25: '', vector: '' } : WITHOUT_REFERENCES;
    const match = ftsMatchExpression(query.text);
    const bm25 =
      match === undefined
        ? []
        : RowIds.parse(
            this.#db
              .prepare(
                `select rowid from slides_fts where slides_fts match ? ${filter.bm25} order by rank limit ?`,
              )
              .pluck()
              .all(match, depth),
          );
    const nearest = RowIds.parse(
      this.#db
        .prepare(
          `select rowid from slide_vec where embedding match ? and k = ? ${filter.vector} order by distance`,
        )
        .pluck()
        .all(query.embedding, depth),
    );
    const byId = this.#db.prepare(`select id, ${SLIDE_COLUMNS} from slides where id = ?`);
    return fuseByReciprocalRank([bm25, nearest])
      .slice(0, k)
      .map((id) => {
        const slide = slideFromRow(byId.get(id), this.#courseId);
        return { sourceId: slide.sourceId, record: slide.record };
      });
  }

  /** Replaces a slide's topic tags (`docs/plan.md` §3.2): metadata, never content. */
  setTopics(sourceId: SourceId, tags: readonly string[]): SetTopicsResult {
    const id = RowId.optional().parse(
      this.#db.prepare('select id from slides where source_id = ?').pluck().get(sourceId),
    );
    if (id === undefined) return { status: 'no-such-slide' };
    const insert = this.#db.prepare('insert or ignore into topics (slide_id, tag) values (?, ?)');
    this.#db.transaction(() => {
      this.#db.prepare('delete from topics where slide_id = ?').run(id);
      for (const tag of tags) insert.run(id, tag);
    })();
    return { status: 'set' };
  }

  /** Every slide tagged `tag`, by lecture then slide number. */
  slidesTagged(tag: string): readonly SlideRecord[] {
    return this.#storedSlides(
      'where id in (select slide_id from topics where tag = ?) order by lecture_id, slide_no',
      tag,
    ).map((slide) => slide.record);
  }

  /** Swaps every vector and the recorded embedder in one transaction; `embeddings` must cover every slide. */
  replaceEmbedder(
    embedder: EmbedderIdentity,
    embeddings: ReadonlyMap<SourceId, Float32Array>,
  ): void {
    const stored = this.#storedSlides('');
    const vectors = stored.map((slide) => {
      const embedding = embeddings.get(slide.sourceId);
      if (embedding === undefined)
        throw new Error(`replaceEmbedder: no embedding for ${slide.sourceId}`);
      requireDimension(`replaceEmbedder(${slide.sourceId})`, embedding, embedder);
      return { id: slide.id, embedding };
    });
    if (embeddings.size !== stored.length)
      throw new Error('replaceEmbedder: embeddings name slides the course lacks');
    this.#db.transaction(() => {
      this.#db.exec('drop table slide_vec');
      createVectorTable(this.#db, embedder.dimension);
      for (const { id, embedding } of vectors) this.#writeVector(id, embedding);
      this.#db
        .prepare('update course set embedder_model = ?, embedder_dimension = ?')
        .run(embedder.model, embedder.dimension);
    })();
    this.#embedder = embedder;
  }

  deck(lectureId: LectureId): Deck | undefined {
    return readDeck(this.#db, lectureId);
  }

  slideImage(lectureId: LectureId, slideNo: SlideNo): SlideImage | undefined {
    return readSlideImage(this.#db, lectureId, slideNo);
  }

  close(): void {
    this.#db.close();
  }
}
