import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexed, openOrFail, slide, tempCourse } from './course-fixture';
import { EmbedderIdentity } from './embedder-identity';

// docs/adr/0004-storage.md § Decision (f) asks for latency and size at course scale.
// CRAM_MEASURE=1 pnpm --filter @cram/index exec vitest run src/retrieval.measure.test.ts
const SLIDES = 3000;
const WORDS_PER_SLIDE = 120;
const VOCABULARY = 8000;
const QUERIES = 200;
const embedder = EmbedderIdentity.parse({ model: 'measure-embedder', dimension: 1024 });

const seeded = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const random = seeded(11);
const word = (): string => `w${String(Math.floor(VOCABULARY * random() ** 2))}`;
const text = (words: number): string => Array.from({ length: words }, word).join(' ');
const embedding = (): Float32Array =>
  Float32Array.from({ length: embedder.dimension }, () => random() - 0.5);
const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN;

describe.runIf(process.env.CRAM_MEASURE === '1')('retrieval at course scale', () => {
  it('reports indexing time, file size and search latency', () => {
    const temp = tempCourse(embedder);
    try {
      const course = openOrFail(temp.spec);
      const slides = Array.from({ length: SLIDES }, (_, index) =>
        indexed(
          slide({
            lectureId: `lecture-${String(index % 24)}`,
            slideNo: index + 1,
            body: text(WORDS_PER_SLIDE),
          }),
          embedding(),
        ),
      );
      const started = performance.now();
      course.upsertSlides(slides);
      const indexedMs = performance.now() - started;
      course.close();
      const sizeMiB = statSync(temp.spec.path).size / 2 ** 20;
      const reopened = openOrFail(temp.spec);
      const queries = Array.from({ length: QUERIES }, () => ({
        text: text(12),
        embedding: embedding(),
      }));
      const latencies = queries
        .map((query) => {
          const t0 = performance.now();
          expect(reopened.search(query).length).toBeGreaterThan(0);
          return performance.now() - t0;
        })
        .sort((a, b) => a - b);
      reopened.close();
      console.info(
        [
          `slides=${String(SLIDES)} dims=${String(embedder.dimension)} words/slide=${String(WORDS_PER_SLIDE)}`,
          `indexing=${indexedMs.toFixed(0)}ms file=${sizeMiB.toFixed(1)}MiB`,
          `search p50=${percentile(latencies, 0.5).toFixed(2)}ms p95=${percentile(latencies, 0.95).toFixed(2)}ms max=${percentile(latencies, 1).toFixed(2)}ms over ${String(QUERIES)} queries`,
        ].join('\n'),
      );
    } finally {
      temp.remove();
    }
  });
});
