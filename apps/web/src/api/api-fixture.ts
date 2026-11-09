import {
  type AskReply,
  CourseId,
  LectureId,
  type RetrievedSlide,
  type SlideRecord,
  SlideNo,
  SourceHash,
  SourceId,
  type AttributedSentence,
  type SentenceStanding,
  type Explanation,
  type WithheldSentence,
} from '@cram/shared';
import { ApiClient, type Fetch } from './api-client';

/** A synthetic slide; every field the test does not name is a fixed placeholder. */
export const retrievedSlide = (
  sourceId: string,
  fields: Partial<Omit<SlideRecord, 'slideNo'>> & { readonly slideNo?: number } = {},
): RetrievedSlide => {
  const { slideNo = 1, ...rest } = fields;
  return {
    sourceId: SourceId.parse(sourceId),
    record: {
      courseId: CourseId.parse('bio'),
      lectureId: LectureId.parse('l1'),
      lectureTitle: 'Lecture 1: The Hive',
      kind: 'content',
      title: '',
      body: '',
      speakerNotes: '',
      imageCaptions: [],
      derived: false,
      sourceHash: SourceHash.parse('h'),
      ...rest,
      slideNo: SlideNo.parse(slideNo),
    },
  };
};

export const HOLLOWMERE_QUEEN = retrievedSlide('h1-2', {
  courseId: CourseId.parse('hollowmere'),
  lectureId: LectureId.parse('lecture-01'),
  lectureTitle: 'The colony and its castes',
  slideNo: 2,
  title: 'The queen',
  body: [
    'One queen per colony',
    "The queen is the colony's only female",
    'She lays up to 1,500 eggs a day at the height of summer',
    'She is fed on royal jelly throughout her life',
  ].join('\n'),
});

export const HOLLOWMERE_COMB_CHART = retrievedSlide('h3-3', {
  courseId: CourseId.parse('hollowmere'),
  lectureId: LectureId.parse('lecture-03'),
  lectureTitle: 'Wax and comb',
  slideNo: 3,
  kind: 'image-only',
});

export const sentence = (
  text: string,
  slides: readonly string[],
  standing: SentenceStanding = 'attributed',
): AttributedSentence => ({
  text,
  slides: slides.map((id) => SourceId.parse(id)),
  contradicts: [],
  standing,
});

export const HIVE = retrievedSlide('s1', {
  slideNo: 4,
  title: 'Castes',
  body: 'Worker bees are female.\nDrones are male.',
});
export const COMB = retrievedSlide('s2', {
  slideNo: 7,
  title: 'The comb',
  body: 'Cells are hexagonal.',
});

export const WITHHELD: WithheldSentence[] = [
  { reason: 'unsupported', text: 'Queens rule the hive.' },
];

export const DROPPED: WithheldSentence[] = [
  { reason: 'dangling-citation', text: 'Worker bees are female.', sourceId: SourceId.parse('s1') },
];

const SENTENCES = [
  sentence('Workers are female.', ['s1']),
  sentence('Drones are male, and comb cells are hexagonal.', ['s1', 's2']),
];

export const GROUNDED: Extract<AskReply, { status: 'grounded' }> = {
  status: 'grounded',
  explanation: {
    text: SENTENCES.map(({ text }) => text).join(' '),
    quotes: [{ sourceId: SourceId.parse('s1'), quote: 'Drones are male.' }],
    sentences: SENTENCES,
    sources: [SourceId.parse('s1'), SourceId.parse('s2')],
  },
  withheld: DROPPED,
  slides: [HIVE, COMB],
  leftOut: [],
};

export const CONTRADICTED: Explanation = {
  text: 'Workers are female. Drones forage for nectar.',
  quotes: [],
  sentences: [
    sentence('Workers are female.', ['s1']),
    {
      ...sentence('Drones forage for nectar.', ['s2', 's1']),
      contradicts: [SourceId.parse('s1')],
    },
  ],
  sources: [SourceId.parse('s1'), SourceId.parse('s2')],
};

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface Sent {
  /** The path and query, as the app wrote them. */
  readonly path: string;
  readonly method: string;
  readonly contentType: string | null;
  readonly body: string;
}

/** A client over a fake transport: `route` answers each request, and `sent` records them. */
export const fakeApi = (
  route: (sent: Sent) => Reply | Promise<Reply>,
): { readonly api: ApiClient; readonly sent: Sent[] } => {
  const sent: Sent[] = [];
  const fetchFn: Fetch = async (request) => {
    const url = new URL(request.url);
    const recorded = {
      path: `${url.pathname}${url.search}`,
      method: request.method,
      contentType: request.headers.get('content-type'),
      body: await request.text(),
    };
    sent.push(recorded);
    const { status, body } = await route(recorded);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { api: new ApiClient(fetchFn), sent };
};
