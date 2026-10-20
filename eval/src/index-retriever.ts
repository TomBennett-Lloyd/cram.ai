import type { Embedder } from '@cram/gateway';
import { slideText } from '@cram/grounding';
import { type CourseIndex, openCourse } from '@cram/index';
import type { CourseId, Deck, RetrievedSlide, SlideRecord } from '@cram/shared';

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

const embedAll = async (embedder: Embedder, texts: readonly string[]) => {
  const vectors = await embedder.embed({ texts: [...texts] });
  if (vectors.length !== texts.length)
    throw new Error(
      `IndexRetriever: embedder returned ${String(vectors.length)} vectors for ${String(texts.length)} texts`,
    );
  return vectors;
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

  /** Slides are embedded one lecture per call, as `slideText` gives them to the generator. */
  static async open(spec: IndexRetrieverSpec): Promise<IndexRetriever> {
    const embedded = [];
    for (const lecture of spec.lectures) {
      const vectors = await embedAll(spec.embedder, lecture.slides.map(slideText));
      embedded.push({ lecture, vectors });
    }
    const dimension = embedded.flatMap(({ vectors }) => vectors)[0]?.length;
    if (dimension === undefined) throw new Error('IndexRetriever: the course has no slide');
    const opened = openCourse({
      path: ':memory:',
      courseId: spec.courseId,
      embedder: { model: spec.embedder.pin.model, dimension },
    });
    if (opened.status !== 'open')
      throw new Error(`IndexRetriever: in-memory course file not open: ${opened.status}`);
    for (const { lecture, vectors } of embedded) {
      const slides = lecture.slides.flatMap((record, index) => {
        const embedding = vectors[index];
        return embedding === undefined ? [] : [{ record, embedding }];
      });
      opened.course.replaceLecture(lecture.deck, [], slides);
    }
    return new IndexRetriever(opened.course, spec.embedder, spec.k);
  }

  async retrieve(question: string): Promise<readonly RetrievedSlide[]> {
    const [embedding] = await embedAll(this.#embedder, [question]);
    if (embedding === undefined) throw new Error('IndexRetriever: no query vector');
    return this.#course
      .search({ text: question, embedding }, this.#k)
      .map(({ sourceId, record }) => ({ sourceId, record }));
  }

  close(): void {
    this.#course.close();
  }
}
