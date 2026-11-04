import { mkdtempSync, rmSync } from 'node:fs';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChatRequest,
  type ChatResult,
  chatWireRequest,
  type Embedder,
  type EmbeddingResult,
  type EmbedRequest,
  type EntailmentResult,
  FakeGateway,
  type Generator,
  type GeneratorReply,
  type ModelGateway,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
  RecordingMissError,
} from '@cram/gateway';
import {
  explanationRequest,
  generationRequest,
  scoredPremises,
  slidePremise,
  SUMMARY_MAX_UNITS,
} from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import { ingestPdf } from '@cram/ingest';
import { CourseId, LectureId, type LoadedSummary, type RetrievedSlide } from '@cram/shared';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { type CramServer, startServer } from './server';
import type { LogEntry } from './server-log';
import { PROBE_TEXT } from './slide-embedding';

const DIMENSION = 8;

const wordVector = (text: string): Float32Array<ArrayBuffer> => {
  const vector = new Float32Array(DIMENSION);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let bucket = 0;
    for (const char of word) bucket = (bucket * 31 + char.charCodeAt(0)) % DIMENSION;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  return vector;
};

/** Deterministic bag-of-words vectors: the embedder role with no model behind it. */
export class WordEmbedder implements Embedder {
  readonly pin = PROVISIONAL_DEFAULT_PINS.embedder;

  embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return Promise.resolve(
      request.texts.map((text) => ({ status: 'embedded', vector: wordVector(text) })),
    );
  }
}

/** A `WordEmbedder` whose input limit is `maxWords` words, counted as its tokens. */
export class ShortEmbedder extends WordEmbedder {
  readonly #maxWords: number;

  constructor(maxWords: number) {
    super();
    this.#maxWords = maxWords;
  }

  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    return Promise.resolve(
      request.texts.map((text) => {
        const inputTokens = text.split(/\s+/).filter(Boolean).length;
        return inputTokens > this.#maxWords
          ? { status: 'over-length', inputTokens, maxInputTokens: this.#maxWords }
          : { status: 'embedded', vector: wordVector(text) };
      }),
    );
  }
}

/** Answers its start-up probe, then throws on every other text with that text as the message. */
export class FailingEmbedder extends WordEmbedder {
  override embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    const [text] = request.texts;
    return text === PROBE_TEXT ? super.embed(request) : Promise.reject(new Error(text));
  }
}

/** Answers its start-up probe, and holds every other text until `open` is called. */
export class GatedEmbedder extends WordEmbedder {
  #open: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#open = resolve;
  });

  open(): void {
    this.#open();
  }

  override async embed(request: EmbedRequest): Promise<readonly EmbeddingResult[]> {
    if (request.texts[0] !== PROBE_TEXT) await this.#gate;
    return super.embed(request);
  }
}

const sampling = { temperature: 0, seed: 0 };
const maxOutputTokens = 512;

const UNSCRIPTED: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['units', { units: [{ text: 'Unscripted.', citations: [] }] }],
  ['topic-tags', { tags: [] }],
]);

/** An unrecorded summary call writes one uncited unit, which resolution withholds, and a tag call names none, so a test can upload unscripted. */
class UnscriptedCalls implements Generator {
  readonly #inner: Generator;
  readonly pin: Generator['pin'];
  readonly sampling: Generator['sampling'];
  readonly maxOutputTokens: number;
  readonly served: Generator['served'];

  constructor(inner: Generator) {
    this.#inner = inner;
    this.pin = inner.pin;
    this.sampling = inner.sampling;
    this.maxOutputTokens = inner.maxOutputTokens;
    this.served = inner.served;
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    try {
      return await this.#inner.chat(request);
    } catch (error) {
      if (!(error instanceof RecordingMissError)) throw error;
      const unscripted = UNSCRIPTED.get(request.output.name);
      if (unscripted === undefined) throw error;
      return { status: 'completed', value: request.output.schema.parse(unscripted) };
    }
  }
}

export const gatewayOf = (
  recordings: readonly Recording[],
  embedder: Embedder = new WordEmbedder(),
): ModelGateway => {
  const fake = new FakeGateway({
    pins: PROVISIONAL_DEFAULT_PINS,
    sampling,
    maxOutputTokens,
    recordings,
  });
  const generator = new UnscriptedCalls(fake.generator);
  return { generator, verifier: fake.verifier, embedder, reranker: null };
};

export const summarised = (
  lectureTitle: string,
  slides: readonly RetrievedSlide[],
  reply: GeneratorReply,
): Recording => ({
  role: 'generator',
  pin: PROVISIONAL_DEFAULT_PINS.generator,
  sampling,
  maxOutputTokens,
  request: chatWireRequest(
    generationRequest(
      { kind: 'lecture-summary', lectureTitle, maxUnits: SUMMARY_MAX_UNITS },
      slides,
    ),
  ),
  reply,
});

export interface TestServer {
  readonly server: CramServer;
  readonly dataDir: string;
  readonly logs: LogEntry[];
}

export const startTestServer = async (
  gateway: ModelGateway = gatewayOf([]),
  dataDir: string = mkdtempSync(join(tmpdir(), 'cram-server-')),
): Promise<TestServer> => {
  const logs: LogEntry[] = [];
  const server = await startServer({ gateway, dataDir, port: 0, log: (entry) => logs.push(entry) });
  return { server, dataDir, logs };
};

export const stopTestServer = async ({ server, dataDir }: TestServer): Promise<void> => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
};

export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
}

export interface Received {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly json: unknown;
}

export const send = (port: number, sent: Sent): Promise<Received> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, method: sent.method, path: sent.path, headers: sent.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        });
      },
    );
    request.on('error', reject);
    request.end(sent.body);
  });

export const PDF = 'application/pdf';

export const uploadPath = (courseId: string, lectureId: string, fileName: string): string =>
  `/courses/${courseId}/decks?${new URLSearchParams({ lectureId, fileName }).toString()}`;

/** A synthetic PDF deck, one page per entry; a page with no lines is image-only. */
export const pdfDeck = async (pages: readonly (readonly string[])[]): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([960, 540]);
    lines.forEach((text, index) => {
      page.drawText(text, { x: 40, y: 480 - index * 40, size: index === 0 ? 32 : 20, font });
    });
  }
  return doc.save();
};

/** Polls the ingest status until no upload, summary or repair is still queued, under way or running. */
export const settledStatus = async (port: number, courseId: string): Promise<Received> => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const status = await send(port, { method: 'GET', path: `/courses/${courseId}/ingest` });
    const text = JSON.stringify(status.json);
    const busy = ['"queued"', '"ingesting"', '"summarising"', '"running"'];
    if (!busy.some((state) => text.includes(state))) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`settledStatus: ${courseId} never settled`);
};

export const retrievedFrom = async (
  bytes: Uint8Array,
  courseId: string,
  lectureId: string,
  fileName: string,
): Promise<RetrievedSlide[]> => {
  const ingested = await ingestPdf({
    bytes,
    fileName,
    courseId: CourseId.parse(courseId),
    lectureId: LectureId.parse(lectureId),
  });
  if (ingested.status !== 'ingested') throw new Error('retrievedFrom: fixture deck unreadable');
  return ingested.slides.map((record) => ({ sourceId: sourceIdOf(record), record }));
};

export const explained = (
  question: string,
  retrieved: readonly RetrievedSlide[],
  reply: GeneratorReply,
  summaries: readonly LoadedSummary[] = [],
): Recording => ({
  role: 'generator',
  pin: PROVISIONAL_DEFAULT_PINS.generator,
  sampling,
  maxOutputTokens,
  request: chatWireRequest(explanationRequest(question, { raw: retrieved, summaries })),
  reply,
});

export const explanationReply = (text: string): GeneratorReply => ({
  status: 'content',
  content: JSON.stringify({ answer: { text, quotes: [] } }),
});

export const marked = (
  sentences: readonly { readonly text: string; readonly slides: readonly RetrievedSlide[] }[],
  result: EntailmentResult,
): Recording => {
  const pairs = sentences.flatMap(({ text, slides }) =>
    scoredPremises(slides.map(slidePremise)).map(({ text: premise }) => ({
      premise,
      hypothesis: text,
    })),
  );
  return {
    role: 'verifier',
    pin: PROVISIONAL_DEFAULT_PINS.verifier,
    request: { pairs },
    reply: { results: pairs.map(() => result) },
  };
};
