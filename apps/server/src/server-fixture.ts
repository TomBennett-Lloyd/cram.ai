import { mkdtempSync, rmSync } from 'node:fs';
import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chatWireRequest,
  type Embedder,
  type EmbedRequest,
  type EntailmentResult,
  FakeGateway,
  type GeneratorReply,
  type ModelGateway,
  PROVISIONAL_DEFAULT_PINS,
  type Recording,
} from '@cram/gateway';
import { generationRequest, splitClaims } from '@cram/grounding';
import { sourceIdOf } from '@cram/index';
import { ingestPdf } from '@cram/ingest';
import {
  type Citation,
  CourseId,
  LectureId,
  type RetrievedSlide,
  SourceId,
  type Unit,
} from '@cram/shared';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { type CramServer, startServer } from './server';
import type { LogEntry } from './server-log';
import { PROBE_TEXT } from './slide-embedding';

const DIMENSION = 8;

const wordVector = (text: string): Float32Array => {
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

  embed(request: EmbedRequest): Promise<readonly Float32Array[]> {
    return Promise.resolve(request.texts.map(wordVector));
  }
}

/** Answers its start-up probe, then throws on every other text with that text as the message. */
export class FailingEmbedder extends WordEmbedder {
  override embed(request: EmbedRequest): Promise<readonly Float32Array[]> {
    const [text] = request.texts;
    return text === PROBE_TEXT ? super.embed(request) : Promise.reject(new Error(text));
  }
}

const sampling = { temperature: 0, seed: 0 };

export const gatewayOf = (
  recordings: readonly Recording[],
  embedder: Embedder = new WordEmbedder(),
): ModelGateway => {
  const fake = new FakeGateway({ pins: PROVISIONAL_DEFAULT_PINS, sampling, recordings });
  return { generator: fake.generator, verifier: fake.verifier, embedder, reranker: null };
};

export interface TestServer {
  readonly server: CramServer;
  readonly dataDir: string;
  readonly logs: LogEntry[];
}

export const startTestServer = async (
  gateway: ModelGateway = gatewayOf([]),
): Promise<TestServer> => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cram-server-'));
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

/** Polls the ingest status until no upload is still queued or ingesting. */
export const settledStatus = async (port: number, courseId: string): Promise<Received> => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const status = await send(port, { method: 'GET', path: `/courses/${courseId}/ingest` });
    const text = JSON.stringify(status.json);
    if (!text.includes('"queued"') && !text.includes('"ingesting"')) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`settledStatus: ${courseId} never settled`);
};

/** The slides `@cram/ingest` reads from `bytes`, as the course index will return them. */
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
  return ingested.slides.map(({ record }) => ({ sourceId: sourceIdOf(record), record }));
};

export const cite = (sourceId: string, quote: string): Citation => ({
  sourceId: SourceId.parse(sourceId),
  quote,
});

export const answer = (text: string, citations: readonly Citation[]): Unit => ({
  text,
  citations: [...citations],
  kind: 'answer-sentence',
});

export const generated = (
  question: string,
  retrieved: readonly RetrievedSlide[],
  reply: GeneratorReply,
): Recording => ({
  role: 'generator',
  pin: PROVISIONAL_DEFAULT_PINS.generator,
  sampling,
  request: chatWireRequest(generationRequest({ kind: 'answer-sentence', question }, retrieved)),
  reply,
});

export const judged = (unit: Unit, result: EntailmentResult): Recording => ({
  role: 'verifier',
  pin: PROVISIONAL_DEFAULT_PINS.verifier,
  request: {
    pairs: splitClaims(unit.text).map((hypothesis) => ({
      premise: unit.citations.map((citation) => citation.quote).join('\n'),
      hypothesis,
    })),
  },
  reply: { results: splitClaims(unit.text).map(() => result) },
});
