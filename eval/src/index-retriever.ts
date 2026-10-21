import type { Embedder } from '@cram/gateway';
import {
  type CourseIndex,
  embedSlideChunks,
  type IndexedSlide,
  openCourse,
  sourceIdOf,
} from '@cram/index';
import { type CourseId, type Deck, type RetrievedSlide, type SlideRecord } from '@cram/shared';

/** One lecture's stored deck and the records ingest made of it. */
export interface IndexedLecture {
  readonly deck: Deck;
  readonly slides: readonly SlideRecord[];
}

export interface IndexRetrieverSpec {
  readonly courseId: CourseId;
  readonly lectures: readonly IndexedLecture[];
  readonly embedder: Embedder;
  readonly k: number;
}

/** One vector per text; an over-length question rejects the run (#184). */
const embedAll = async (
  embedder: Embedder,
  texts: readonly string[],
): Promise<readonly Float32Array[]> => {
  const results = await embedder.embed({ texts: [...texts] });
  if (results.length !== texts.length)
    throw new Error(
      `IndexRetriever: embedder returned ${String(results.length)} results for ${String(texts.length)} texts`,
    );
  return results.map((result, index) => {
    if (result.status === 'embedded') return result.vector;
    throw new Error(
      `IndexRetriever: text ${String(index)} is ${String(result.inputTokens)} tokens, over the embedder's ${String(result.maxInputTokens)}`,
    );
  });
};

/** Retrieval through `@cram/index` over an in-memory course file, embedding through the gateway. */
export class IndexRetriever {
  readonly #course: CourseIndex;
  readonly #embedder: Embedder;
  readonly #k: number;

  private constructor(course: CourseIndex, embedder: Embedder, k: number) {
    this.#course = course;
    this.#embedder = embedder;
    this.#k = k;
  }

  /** Indexes one lecture at a time through `embedSlideChunks`, as ingest does; a slide left without a vector rejects the run (#184). */
  static async open(spec: IndexRetrieverSpec): Promise<IndexRetriever> {
    const embedded: {
      readonly lecture: IndexedLecture;
      readonly slides: readonly IndexedSlide[];
    }[] = [];
    for (const lecture of spec.lectures) {
      const slides = await embedSlideChunks(
        (texts) => spec.embedder.embed({ texts: [...texts] }),
        lecture.slides,
      );
      const unembedded = slides.find(({ chunks }) => chunks.some(({ embedding }) => !embedding));
      if (unembedded !== undefined)
        throw new Error(
          `IndexRetriever: slide ${sourceIdOf(unembedded.record)} holds a line longer than the embedder takes`,
        );
      embedded.push({ lecture, slides });
    }
    const dimension = embedded.flatMap(({ slides }) => slides)[0]?.chunks[0].embedding?.length;
    if (dimension === undefined) throw new Error('IndexRetriever: the course has no slide');
    const opened = openCourse({
      path: ':memory:',
      courseId: spec.courseId,
      embedder: { model: spec.embedder.pin.model, dimension },
    });
    if (opened.status !== 'open')
      throw new Error(`IndexRetriever: in-memory course file not open: ${opened.status}`);
    for (const { lecture, slides } of embedded)
      opened.course.replaceLecture(lecture.deck, [], slides);
    return new IndexRetriever(opened.course, spec.embedder, spec.k);
  }

  async retrieve(question: string): Promise<readonly RetrievedSlide[]> {
    const correction = this.#course.correctSpelling(question);
    const text = correction.status === 'corrected' ? correction.searched : question;
    const [embedding] = await embedAll(this.#embedder, [text]);
    if (embedding === undefined) throw new Error('IndexRetriever: no query vector');
    return this.#course.search({ text, embedding }, this.#k);
  }

  close(): void {
    this.#course.close();
  }
}
