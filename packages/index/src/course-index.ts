import type { Database } from 'better-sqlite3';
import {
  type CourseId,
  type Deck,
  type DiscardedTable,
  type LectureId,
  type RebuildReportRevision,
  type RetrievedSlide,
  type SlideChunk,
  type SlideImage,
  type SlideNo,
  type SlideRecord,
  type SourceId,
  type StoredLecture,
  type TopicTag,
} from '@cram/shared';
import { z } from 'zod';
import { CHUNK_COLUMNS, chunkFromRow, chunkRowValues, ftsValues } from './chunk-row';
import {
  confirmationState,
  confirmDerived,
  dropVoidConfirmations,
  UNCONFIRMED_DERIVED,
  type ConfirmationState,
  type ConfirmResult,
} from './confirmation';
import type { EmbedderIdentity } from './embedder-identity';
import { ftsMatchExpression } from './fts-query';
import {
  type IndexedChunk,
  type IndexedSlide,
  requireDimension,
  requireSlideChunks,
} from './indexed-slide';
import { listFilters } from './list-filter';
import { fuseByReciprocalRank } from './reciprocal-rank';
import { dismissRebuildReport, rebuildReportOf, recordRebuildReport } from './rebuild-report';
import { createVectorTable } from './schema';
import { storedLectures } from './stored-lectures';
import {
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

/** Chunks each ranked list reads before its dedupe to slides (`docs/adr/0008-slide-chunking.md` § Decision (f)); provisional as `RETRIEVAL_K` is. */
export const CANDIDATES_PER_LIST = 50;

export interface SearchQuery {
  readonly text: string;
  readonly embedding: Float32Array;
  /** Off by default: references pages would dominate BM25 (#9's sizing comment, #78). */
  readonly includeReferences?: boolean;
  /** On for exam generation only (`docs/standards/grounding.md` rule 10); Ask and notes cite derived text unconfirmed. */
  readonly excludeUnconfirmedDerived?: boolean;
}

/** A listing exam generation can draw its target slides from (`docs/plan.md` §3.5). */
export interface SlideListing {
  /** On for exam generation only, as `SearchQuery.excludeUnconfirmedDerived` is. */
  readonly excludeUnconfirmedDerived?: boolean;
}

const listed = (listing: SlideListing): string =>
  listing.excludeUnconfirmedDerived === true ? `and not (${UNCONFIRMED_DERIVED})` : '';

export type SetTopicsResult = { readonly status: 'set' } | { readonly status: 'no-such-slide' };

export type RemoveLectureResult =
  { readonly status: 'removed' } | { readonly status: 'no-such-lecture' };

const RowId = z.number().int();
const RowIds = z.array(RowId);

/** Each slide once, at its best chunk's rank (`docs/adr/0008-slide-chunking.md` § Decision (f)). */
const firstPerSlide = (
  chunkIds: readonly number[],
  slideOf: (chunkId: number) => number,
): readonly number[] => [...new Set(chunkIds.map(slideOf))];

const INSERT_SLIDE = `insert into slides (${SLIDE_COLUMNS}) values (${SLIDE_COLUMNS.replace(/\w+/g, '?')}) returning id`;
const INSERT_CHUNK = `insert into chunks (${CHUNK_COLUMNS}) values (${CHUNK_COLUMNS.replace(/\w+/g, '?')}) returning id`;

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

  /** Deletes a slide's chunks and their index rows, keeping the slide. */
  #dropIndexRows(slideId: number): void {
    const chunkIds = RowIds.parse(
      this.#db.prepare('select id from chunks where slide_id = ?').pluck().all(slideId),
    );
    for (const id of chunkIds) {
      this.#db.prepare('delete from slides_fts where rowid = ?').run(id);
      this.#db.prepare('delete from slide_vec where rowid = ?').run(BigInt(id));
    }
    this.#db.prepare('delete from chunks where slide_id = ?').run(slideId);
  }

  #writeVector(id: number, embedding: Float32Array): void {
    this.#db
      .prepare('insert into slide_vec (rowid, embedding) values (?, ?)')
      .run(BigInt(id), embedding);
  }

  /** Refuses a batch before anything is written. */
  #checkBatch(operation: string, slides: readonly IndexedSlide[]): void {
    const seen = new Set<SourceId>();
    for (const { record, chunks } of slides) {
      const sourceId = sourceIdOf(record);
      if (record.courseId !== this.#courseId) {
        throw new Error(
          `${operation}: ${sourceId} belongs to course ${record.courseId}, not ${this.#courseId}`,
        );
      }
      if (seen.has(sourceId))
        throw new Error(`${operation}: ${sourceId} appears twice in one batch`);
      seen.add(sourceId);
      requireSlideChunks(operation, record, chunks, this.#embedder);
    }
  }

  /** A slide's chunks, their text rows and the vectors they have; the caller holds the transaction. */
  #writeChunks(slideId: number, lectureTitle: string, chunks: readonly IndexedChunk[]): void {
    const insert = this.#db.prepare(INSERT_CHUNK).pluck();
    const writeText = this.#db.prepare(
      'insert into slides_fts (rowid, lecture_title, title, body, speaker_notes, image_captions) values (?, ?, ?, ?, ?, ?)',
    );
    for (const { chunk, embedding } of chunks) {
      const id = RowId.parse(insert.get(...chunkRowValues(slideId, chunk)));
      writeText.run(id, ...ftsValues(lectureTitle, chunk));
      if (embedding !== undefined) this.#writeVector(id, embedding);
    }
  }

  /** Each slide and its chunks; the caller holds the transaction and has dropped the lecture's rows. */
  #writeSlides(slides: readonly IndexedSlide[]): void {
    const insert = this.#db.prepare(INSERT_SLIDE).pluck();
    for (const { record, chunks } of slides) {
      const id = RowId.parse(insert.get(...slideRowValues(record)));
      this.#writeChunks(id, record.lectureTitle, chunks);
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
   * A confirmation outlives it while its slide's text does.
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
      dropVoidConfirmations(this.#db);
    })();
  }

  /** Deletes the lecture's slides, deck and slide images in one transaction, so no rebuild brings it back. */
  removeLecture(lectureId: LectureId): RemoveLectureResult {
    const removed = this.#db.transaction(() => {
      this.#dropLectureSlides(lectureId);
      dropVoidConfirmations(this.#db);
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
  slides(listing: SlideListing = {}): readonly SlideRecord[] {
    return this.#storedSlides(`where true ${listed(listing)} order by lecture_id, slide_no`).map(
      (slide) => slide.record,
    );
  }

  /** The chunks a slide is indexed as, in order; none for a slide the course lacks. */
  chunks(sourceId: SourceId): readonly SlideChunk[] {
    return this.#db
      .prepare(
        `select chunk_no, title, body, speaker_notes, image_captions from chunks
          where slide_id = (select id from slides where source_id = ?) order by chunk_no`,
      )
      .all(sourceId)
      .map(chunkFromRow);
  }

  /**
   * BM25 and vector candidates fused by reciprocal rank (`docs/adr/0004-storage.md` § Decision (c)), best first.
   * Each list leaves out what the query excludes before it is cut to depth: references slides unless
   * included, and unconfirmed derived slides when asked.
   */
  search(query: SearchQuery, k: number = RETRIEVAL_K): readonly RetrievedSlide[] {
    if (!Number.isInteger(k) || k < 1)
      throw new Error(`search: k must be a positive integer, got ${String(k)}`);
    requireDimension('search', query.embedding, this.#embedder);
    const depth = Math.max(k, CANDIDATES_PER_LIST);
    const filter = listFilters({
      references: query.includeReferences !== true,
      unconfirmedDerived: query.excludeUnconfirmedDerived === true,
    });
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
    const slideIdOf = this.#db.prepare('select slide_id from chunks where id = ?').pluck();
    const slideOf = (chunkId: number): number => RowId.parse(slideIdOf.get(chunkId));
    const byId = this.#db.prepare(`select id, ${SLIDE_COLUMNS} from slides where id = ?`);
    return fuseByReciprocalRank([firstPerSlide(bm25, slideOf), firstPerSlide(nearest, slideOf)])
      .slice(0, k)
      .map((id) => {
        const slide = slideFromRow(byId.get(id), this.#courseId);
        return { sourceId: slide.sourceId, record: slide.record };
      });
  }

  /** Replaces a slide's topic tags (`docs/plan.md` §3.2): metadata, never content. */
  setTopics(sourceId: SourceId, tags: readonly TopicTag[]): SetTopicsResult {
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

  /** The student confirms the derived text of `seen`, the record they were shown beside its image (ADR 0006 § Decision (g)). */
  confirmDerived(seen: SlideRecord, confirmedAt: Date): ConfirmResult {
    if (seen.courseId !== this.#courseId) return { status: 'no-such-slide' };
    return confirmDerived(this.#db, sourceIdOf(seen), seen, confirmedAt);
  }

  confirmation(sourceId: SourceId): ConfirmationState {
    return confirmationState(this.#db, sourceId);
  }

  /** Every slide tagged `tag`, by lecture then slide number. */
  slidesTagged(tag: TopicTag, listing: SlideListing = {}): readonly SlideRecord[] {
    return this.#storedSlides(
      `where id in (select slide_id from topics where tag = ?) ${listed(listing)} order by lecture_id, slide_no`,
      tag,
    ).map((slide) => slide.record);
  }

  /**
   * Swaps every slide's chunks and vectors and the recorded embedder in one transaction, so a new
   * embedder re-chunks (`docs/adr/0008-slide-chunking.md` § Decision (i)). `slides` names every slide.
   */
  replaceEmbedder(embedder: EmbedderIdentity, slides: readonly IndexedSlide[]): void {
    const bySource = new Map(slides.map((slide) => [sourceIdOf(slide.record), slide]));
    const stored = this.#storedSlides('');
    const rewritten = stored.map((slide) => {
      const chunks = bySource.get(slide.sourceId)?.chunks;
      if (chunks === undefined)
        throw new Error(`replaceEmbedder: no embedding for ${slide.sourceId}`);
      requireSlideChunks('replaceEmbedder', slide.record, chunks, embedder);
      return { slide, chunks };
    });
    if (bySource.size !== stored.length || slides.length !== stored.length)
      throw new Error('replaceEmbedder: embeddings name a slide twice or one the course lacks');
    this.#db.transaction(() => {
      for (const { slide } of rewritten) this.#dropIndexRows(slide.id);
      this.#db.exec('drop table slide_vec');
      createVectorTable(this.#db, embedder.dimension);
      for (const { slide, chunks } of rewritten)
        this.#writeChunks(slide.id, slide.record.lectureTitle, chunks);
      this.#db
        .prepare('update course set embedder_model = ?, embedder_dimension = ?')
        .run(embedder.model, embedder.dimension);
    })();
    this.#embedder = embedder;
  }

  /** Every lecture with a deck (`storedLectures`). */
  lectures(): readonly StoredLecture[] {
    return storedLectures(this.#db);
  }

  /** What a rebuild discarded that the student has not dismissed (#233). */
  rebuildReport() {
    return rebuildReportOf(this.#db);
  }

  /** Written by `rebuildCourse` into the file it rebuilt. */
  recordRebuildReport(discarded: readonly DiscardedTable[]): void {
    recordRebuildReport(this.#db, discarded);
  }

  dismissRebuildReport(revision: RebuildReportRevision) {
    return dismissRebuildReport(this.#db, revision);
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
