import type { Page, Route } from '@playwright/test';

/** A synthetic course: two slides about bees, authored for these specs. */
const slide = (
  sourceId: string,
  slideNo: number,
  title: string,
  body: string,
  speakerNotes = '',
) => ({
  sourceId,
  record: {
    courseId: 'bio',
    lectureId: 'l1',
    lectureTitle: 'Lecture 1: The Hive',
    slideNo,
    kind: 'content',
    title,
    body,
    speakerNotes,
    imageCaptions: [],
    derived: false,
    sourceHash: 'h',
  },
});

const HIVE = slide(
  's1',
  4,
  'Castes',
  'Worker bees are female.\nDrones are male.',
  'Drones do not forage.',
);
/** Long enough that its card must wrap it at phone width. */
export const COMB_TITLE = 'The comb, and why its cells are hexagonal rather than square or round';
const COMB = slide('s2', 7, COMB_TITLE, 'Cells are hexagonal.');

/** One unbroken word wider than a phone, so the decks list must wrap it. */
export const LONG_FILE_NAME = `${'lecture-01-the-hive-castes-and-the-comb'.repeat(2)}.pdf`;

const unit = (text: string, citations: readonly (readonly [string, string])[]) => ({
  text,
  kind: 'answer-sentence',
  citations: citations.map(([sourceId, quote]) => ({ sourceId, quote })),
});

export const GROUNDED_QUESTION = 'What are drones?';
export const NOT_COVERED_QUESTION = 'Who wrote Hamlet?';

const askReply = (question: string) =>
  question === NOT_COVERED_QUESTION
    ? { status: 'not-covered', withheld: [], slides: [COMB] }
    : {
        status: 'grounded',
        shown: [
          unit('Drones are male.', [['s1', 'Drones are male.']]),
          unit('Workers are female, and comb cells are hexagonal.', [
            ['s1', 'Worker bees are female.'],
            ['s2', 'Cells are hexagonal.'],
          ]),
        ],
        withheld: [
          { reason: 'unsupported', unit: unit('Queens rule the hive.', [['s1', 'Castes']]) },
        ],
        slides: [HIVE, COMB],
      };

/** A stand-in for a stored slide rendering: an SVG, since what is measured is its box, not its pixels. */
const SLIDE_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="white"/><text x="80" y="160" font-size="96">Castes</text></svg>`;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const questionOf = (body: string | null): string => {
  const parsed: unknown = JSON.parse(body ?? '{}');
  return typeof parsed === 'object' && parsed !== null && 'question' in parsed
    ? String(parsed.question)
    : '';
};

/** The rebuild report `stubApi` serves when asked for one, until the app dismisses it. */
const REBUILD_REPORT = {
  state: 'undismissed',
  discarded: [{ table: 'topics', rows: 3 }],
  revision: 'a'.repeat(64),
};
const NO_REPORT = { state: 'none' };

export interface StubOptions {
  /** Every ask reply waits for this; without it, an ask replies at once (#231). */
  readonly askReplyAfter?: Promise<void>;
  /** The course holds `REBUILD_REPORT` and no upload, instead of one upload in flight (#233). */
  readonly rebuildReport?: boolean;
}

/** Answers the app's API calls from the fixtures above, holding one upload's ingest in flight once. */
export const stubApi = async (page: Page, options: StubOptions = {}): Promise<void> => {
  const { rebuildReport = false } = options;
  let ingestReads = 0;
  let report = rebuildReport ? REBUILD_REPORT : NO_REPORT;
  await page.route('**/courses', (route) => json(route, 200, { courses: ['bio'] }));
  await page.route('**/courses/*/slide-image?*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SLIDE_IMAGE }),
  );
  await page.route('**/courses/*/ask', async (route) => {
    await options.askReplyAfter;
    await json(route, 200, askReply(questionOf(route.request().postData())));
  });
  await page.route('**/courses/*/decks?*', (route) =>
    json(route, 202, {
      uploadId: 'u1',
      lectureId: 'l1',
      fileName: 'l1.pdf',
      progress: { state: 'queued' },
    }),
  );
  await page.route('**/courses/*/rebuild-report?*', (route) => {
    report = NO_REPORT;
    return json(route, 200, { status: 'dismissed' });
  });
  await page.route('**/courses/*/ingest', (route) => {
    ingestReads += 1;
    const progress =
      ingestReads < 2
        ? { state: 'ingesting' }
        : { state: 'indexed', slideCount: 2, imageOnly: [], unembedded: [] };
    return json(route, 200, {
      courseId: 'bio',
      stored: { state: 'read', lectures: [], report },
      repair: { state: 'none' },
      uploads: rebuildReport
        ? []
        : [{ uploadId: 'u1', lectureId: 'l1', fileName: LONG_FILE_NAME, progress }],
    });
  });
};
