import type { Page, Route } from '@playwright/test';
import { ChunkTag, TagEdit } from '@cram/shared';

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

const sentence = (
  text: string,
  slides: readonly string[],
  contradicts: readonly string[] = [],
) => ({
  text,
  slides,
  contradicts,
});

export const GROUNDED_QUESTION = 'What are drones?';
export const NOT_COVERED_QUESTION = 'Who wrote Hamlet?';
/** Its answer's second sentence is marked against HIVE, whose speaker notes say drones do not forage. */
export const CONTRADICTED_QUESTION = 'Do drones forage?';
export const CONTRADICTED_SENTENCE =
  'Drones forage for nectar in the comb, whose cells are hexagonal.';
/** Its answer is in paragraphs, the last `CONTRADICTED_SENTENCE` (#466). */
export const PARAGRAPHS_QUESTION = 'How is the hive organised?';
/** Its answer quotes COMB, here read from its picture, beside a quote from typed HIVE (#464). */
export const DERIVED_QUESTION = 'Are comb cells hexagonal?';
/** A quote inside the contradicted sentence, so its underline and the mark's meet. */
const QUOTE_IN_MARK = { sourceId: 's2', quote: 'cells are hexagonal' };

/** A line of HIVE each answer marks as a quote without repeating it word for word, so its mark is dropped. */
export const DROPPED_LINE = 'Worker bees are female.';

const SENTENCES = [
  sentence('Drones are male.', ['s1']),
  sentence('Workers are female, and comb cells are hexagonal.', ['s1', 's2']),
];

const grounded = (
  sentences: readonly ReturnType<typeof sentence>[],
  quotes: readonly { readonly sourceId: string; readonly quote: string }[] = [],
  between = ' ',
  slides: readonly ReturnType<typeof slide>[] = [HIVE, COMB],
) => ({
  status: 'grounded',
  explanation: {
    text: sentences.map(({ text }) => text).join(between),
    quotes: [{ sourceId: 's1', quote: 'Drones are male.' }, ...quotes],
    sentences,
    sources: ['s1', 's2'],
  },
  withheld: [{ reason: 'dangling-citation', text: DROPPED_LINE, sourceId: 's1' }],
  slides,
  leftOut: [],
});

const askReply = (question: string) => {
  switch (question) {
    case NOT_COVERED_QUESTION:
      return { status: 'not-covered', withheld: [], slides: [COMB], leftOut: [] };
    case CONTRADICTED_QUESTION:
      return grounded(
        [
          sentence('Drones are male.', ['s1']),
          sentence(CONTRADICTED_SENTENCE, ['s2', 's1'], ['s1']),
        ],
        [QUOTE_IN_MARK],
      );
    case PARAGRAPHS_QUESTION:
      return grounded(
        [...SENTENCES, sentence(CONTRADICTED_SENTENCE, ['s2', 's1'], ['s1'])],
        [QUOTE_IN_MARK],
        '\n\n',
      );
    case DERIVED_QUESTION:
      return grounded(SENTENCES, [{ sourceId: 's2', quote: 'comb cells are hexagonal' }], ' ', [
        HIVE,
        { ...COMB, record: { ...COMB.record, derived: true } },
      ]);
    default:
      return grounded(SENTENCES);
  }
};

/** One unbroken tag wider than a phone, so its chip must wrap it. */
const LONG_TAG = 'hexagonalcombcellgeometry'.repeat(3);

/** The slide browser's lecture: HIVE as one chunk, tagged by the tag pass. */
const lectureSlides = (hiveTags: readonly ChunkTag[]) => ({
  lectureId: 'l1',
  slides: [
    {
      ...HIVE,
      chunks: [
        {
          chunkNo: 1,
          textHash: '1'.repeat(64),
          lines: HIVE.record.body.split('\n'),
          tags: hiveTags,
        },
      ],
    },
    {
      ...COMB,
      chunks: [
        {
          chunkNo: 1,
          textHash: '2'.repeat(64),
          lines: [COMB.record.body],
          tags: [{ tag: LONG_TAG, origin: 'tagger' }],
        },
      ],
    },
  ],
});

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
  /** The course holds one summarised lecture and no upload, its summary with `WITHHELD_SUMMARY_LINE` withheld (#467). */
  readonly summaryWithheld?: boolean;
}

export const WITHHELD_SUMMARY_LINE = 'Drones guard the comb.';

const SUMMARISED_LECTURE = {
  lectureId: 'l1',
  lectureTitle: 'Lecture 1: The Hive',
  slideCount: 2,
  imageOnly: [],
  unembedded: [],
  summarised: true,
  withheld: 1,
};

const summaryUnit = (text: string, quotes: readonly (readonly [string, string])[]) => ({
  text,
  citations: quotes.map(([sourceId, quote]) => ({ sourceId, quote })),
  kind: 'lecture-summary',
});

const SUMMARIES = {
  state: 'read',
  summaries: [
    {
      lectureId: 'l1',
      units: [summaryUnit('Worker bees are female.', [['s1', 'Worker bees are female.']])],
      withheld: [
        {
          reason: 'unsupported',
          unit: summaryUnit(WITHHELD_SUMMARY_LINE, [
            ['s1', 'Drones are male.'],
            ['s2', 'Cells are hexagonal.'],
          ]),
        },
      ],
    },
  ],
  slides: [HIVE, COMB],
};

/** Answers the app's API calls from the fixtures above, holding one upload's ingest in flight once. */
export const stubApi = async (page: Page, options: StubOptions = {}): Promise<void> => {
  const { rebuildReport = false, summaryWithheld = false } = options;
  let ingestReads = 0;
  let report = rebuildReport ? REBUILD_REPORT : NO_REPORT;
  /** Kept in the spec's process, so a `page.reload()` reads back what the page wrote. */
  let hiveTags: readonly ChunkTag[] = ChunkTag.array().parse([
    { tag: 'castes', origin: 'tagger' },
    { tag: 'drones', origin: 'tagger' },
  ]);
  await page.route('**/courses/*/slides?*', (route) => json(route, 200, lectureSlides(hiveTags)));
  await page.route('**/courses/*/tags', (route) => {
    const edit = TagEdit.parse(JSON.parse(route.request().postData() ?? '{}'));
    hiveTags = [...edit.tags]
      .sort()
      .map(
        (tag) => hiveTags.find((held) => held.tag === tag) ?? { tag, origin: 'student' as const },
      );
    return json(route, 200, { sourceId: HIVE.sourceId, chunkNo: 1, tags: hiveTags });
  });
  await page.route('**/courses', (route) => json(route, 200, { courses: ['bio'] }));
  await page.route('**/courses/*/summaries', (route) => json(route, 200, SUMMARIES));
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
        : { state: 'indexed', slideCount: 2, imageOnly: [], unembedded: [], summarised: false };
    return json(route, 200, {
      courseId: 'bio',
      stored: { state: 'read', lectures: summaryWithheld ? [SUMMARISED_LECTURE] : [], report },
      repair: { state: 'none' },
      uploads:
        rebuildReport || summaryWithheld
          ? []
          : [{ uploadId: 'u1', lectureId: 'l1', fileName: LONG_FILE_NAME, progress }],
      remakes: [],
    });
  });
};
