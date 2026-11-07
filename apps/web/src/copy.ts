import {
  type ApiRefusal,
  type CourseUnavailableProblem,
  DiscardableTable,
  type DiscardedTable,
  type DroppedPointer,
  type SlideRecord,
  type StoredLecture,
  type TopicOrigin,
  type UploadProgress,
  type WithheldSentence,
  type WithheldUnit,
} from '@cram/shared';
import type { ApiFailure } from './api/api-result';

/** The app's async-state and failure wording, in one place (`docs/standards/react.md` § Async surface convention). */
export const PENDING = {
  courses: 'Loading courses…',
  decks: 'Loading decks…',
  answer: 'Checking your slides…',
  repair: 'Updating this course’s stored decks…',
  dismissal: 'Dismissing…',
  summary: 'Loading the summary…',
  remake: 'Making the summary…',
  slides: 'Loading slides…',
} as const;

export const SUMMARY = 'Summary';
export const NO_SUMMARY = 'No summary yet.';
export const SUMMARY_FAILED = 'The summary couldn’t be made.';
export const SUMMARY_ALL_WITHHELD =
  'No line drafted for this summary passed the check against its slides.';
export const MAKE_SUMMARY = 'Make the summary';
export const SUMMARY_REPLACED = 'This lecture’s summary has changed. Close and reopen it.';

/** The fixed system string for a question no shown explanation answers (`docs/standards/grounding.md` rule 5). */
export const NOT_COVERED = 'Your slides don’t cover this.';
export const CLOSEST_SLIDES = 'Closest slides';
export const LEFT_OUT =
  'Not everything found fitted in one answer. These slides, or their lectures’ summaries, were left out:';
export const SEARCHED_FOR = 'Searched for:';
export const NEW_QUESTION = 'New question';
export const SOURCE_MISSING = 'Source not returned';
export const SLIDE_HAS_NO_TEXT = 'This slide has no text to show.';
export const SLIDE_LINES = 'Lines found on this slide';
export const SLIDE_IMAGE_MISSING = 'The picture of this slide can’t be shown.';
export const DERIVED_TEXT =
  'This text was read from the slide’s picture. Check it against the image.';

export const LECTURE_NOT_STORED = 'This course holds no such lecture.';
export const SEE_DECKS = 'See its decks';
export const NO_SLIDES = 'This lecture has no slides.';
export const ADD_TAG = 'Add';
export const NEW_TAG = 'New tag';

export const chunkName = (slideNo: number, chunkNo: number, chunkCount: number): string =>
  chunkCount === 1
    ? `slide ${String(slideNo)}`
    : `slide ${String(slideNo)}, part ${String(chunkNo)}`;

export const tagsLabel = (chunk: string): string => `Tags on ${chunk}`;
export const addTagLabel = (chunk: string): string => `Add a tag to ${chunk}`;
export const removeTagLabel = (tag: string, origin: TopicOrigin): string =>
  origin === 'tagger' ? `Remove the suggested tag ${tag}` : `Remove the tag ${tag}`;

export const MAY_BE_RELEVANT = 'may be relevant';
export const APPEARS_TO_CONTRADICT = 'appears to contradict';
export const SOURCES = 'Sources';
export const ATTRIBUTED_NOTE =
  'Written from your slides. Each sentence is checked only for whether a slide appears to contradict it; the slides listed below are where to look.';
export const DERIVED_SOURCE = 'Text read from the picture';

type SlideName = Pick<SlideRecord, 'slideNo' | 'lectureTitle' | 'derived'>;

const slideName = ({ slideNo, lectureTitle, derived }: SlideName): string => {
  const name = `${lectureTitle}, slide ${String(slideNo)}`;
  return derived ? `${name}. ${DERIVED_SOURCE}` : name;
};

export const SLIDE_CONTRADICTION = `This sentence of the answer ${APPEARS_TO_CONTRADICT} this slide:`;

export const contradictionRefLabel = (number: number, slide: SlideName): string =>
  `Source ${String(number)}: ${APPEARS_TO_CONTRADICT} ${slideName(slide)}`;

export const sourceRefLabel = (number: number, slide: SlideName): string =>
  `Source ${String(number)}: ${slideName(slide)}`;

export const slideImageAlt = ({
  slideNo,
  lectureTitle,
}: Pick<SlideRecord, 'slideNo' | 'lectureTitle'>): string =>
  `Slide ${String(slideNo)} of ${lectureTitle}, as rendered from its deck`;

/** What each reason a course file cannot be opened means to the student, never its code (#299). */
const UNOPENED: Readonly<Record<CourseUnavailableProblem, string>> = {
  'newer-schema': 'was saved by a newer version of cram.ai',
  'older-schema': 'was saved by an older version of cram.ai',
  'not-a-course-file': 'isn’t a cram.ai course file',
  'course-mismatch': 'holds a different course',
  'embedder-mismatch': 'was indexed by a different embedding model',
};

const fileUnopened = (problem: CourseUnavailableProblem): string =>
  `This course’s file ${UNOPENED[problem]}`;

export const RETRY = 'Try again';
export const DISMISS = 'Dismiss';
export const APP_FAILED = 'Something went wrong in cram.ai. Reload the page to start again.';
export const MODEL_FAILED = 'The model didn’t answer. Ask again in a moment.';
export const COURSE_NAME_REFUSED =
  'A course name needs at least one letter or digit, and can’t be a reserved device name.';

const refusalMessage = (refusal: ApiRefusal): string => {
  switch (refusal.status) {
    case 'bad-request':
      return `The server refused the request: ${refusal.issue}`;
    case 'course-unavailable':
      return `${fileUnopened(refusal.problem)}.`;
    case 'question-over-length':
      return `That question is too long for the model to read (at most ${String(refusal.maxInputTokens)} tokens). Shorten it and ask again.`;
    case 'no-such-course':
      return 'This course has no decks yet. Add one first.';
    case 'report-changed':
      return 'This course was rebuilt again since that notice was shown. Read it before dismissing it.';
    case 'chunk-changed':
      return 'This slide changed since this page loaded, so that edit wasn’t saved. It’s shown as it is now.';
    case 'tags-changed':
      return 'These tags changed since this page loaded, so that edit wasn’t saved. They’re shown as they are now.';
    case 'payload-too-large':
      return 'That is too large for the server to accept.';
    case 'unsupported-media-type':
      return 'Only PDF and PowerPoint (.pptx) decks can be read.';
    case 'forbidden':
    case 'not-found':
    case 'method-not-allowed':
    case 'internal-error':
      return `The server could not answer (${refusal.status}).`;
  }
};

export const failureMessage = (failure: ApiFailure): string => {
  switch (failure.status) {
    case 'unreachable':
      return 'Can’t reach the cram.ai server. Check that it is running.';
    case 'malformed':
      return 'The server sent a reply this app doesn’t understand.';
    case 'refused':
      return refusalMessage(failure.refusal);
  }
};

/** "Slide 2 holds", "Slides 2, 5 hold": the list and its verb agree. */
const slidesThat = (slides: readonly number[], one: string, many: string): string =>
  slides.length === 1 ? `Slide ${String(slides[0])} ${one}` : `Slides ${slides.join(', ')} ${many}`;

/** What an indexed deck holds, whether this session's upload or a stored lecture. */
export const indexedMessage = ({
  slideCount,
  imageOnly,
  unembedded,
}: Pick<StoredLecture, 'slideCount' | 'imageOnly' | 'unembedded'>): string =>
  [
    `${String(slideCount)} ${slideCount === 1 ? 'slide' : 'slides'} indexed.`,
    ...(imageOnly.length === 0
      ? []
      : [
          `${slidesThat(imageOnly, 'has too little text to read as a slide, so only a title or speaker notes on it', 'have too little text to read as slides, so only titles or speaker notes on them')} can be cited.`,
        ]),
    ...(unembedded.length === 0
      ? []
      : [
          `${slidesThat(unembedded, 'holds', 'hold')} more text than the search model reads at once, so ${unembedded.length === 1 ? 'it’s' : 'they’re'} found by ${unembedded.length === 1 ? 'its' : 'their'} words only.`,
        ]),
  ].join(' ');

/** Why the course file's lectures are not listed; this session's uploads still are. */
export const storedUnavailableMessage = (problem: CourseUnavailableProblem): string =>
  `${fileUnopened(problem)}, so its stored decks can’t be listed.`;

/** Why the course file's lectures are not listed once its start-up repair has failed (#225). */
export const repairFailedMessage = (problem: CourseUnavailableProblem): string =>
  `${fileUnopened(problem)} and couldn’t be updated, so its stored decks can’t be listed.`;

/** Student words for each `DiscardableTable`; any other table counts as `OTHER_ROW`. */
const DISCARDED_ROW: Readonly<Record<DiscardableTable, readonly [one: string, many: string]>> = {
  topics: ['topic tag', 'topic tags'],
  confirmations: [
    'confirmation of text read from a slide picture',
    'confirmations of text read from slide pictures',
  ],
};
const OTHER_ROW = ['other saved item', 'other saved items'] as const;

const nounOf = (table: string): readonly [string, string] | undefined => {
  const discardable = DiscardableTable.safeParse(table);
  return discardable.success ? DISCARDED_ROW[discardable.data] : undefined;
};

const counted = (rows: number, [one, many]: readonly [string, string]): string =>
  `${String(rows)} ${rows === 1 ? one : many}`;

/** What a rebuild lost (`docs/adr/0004-storage.md` § Decision (d)); `discarded` is not empty. */
export const discardedMessage = (discarded: readonly DiscardedTable[]): string => {
  const named = discarded.flatMap(({ table, rows }) => {
    const noun = nounOf(table);
    return noun === undefined ? [] : [counted(rows, noun)];
  });
  const other = discarded
    .filter(({ table }) => nounOf(table) === undefined)
    .reduce((sum, { rows }) => sum + rows, 0);
  const lost = other === 0 ? named : [...named, counted(other, OTHER_ROW)];
  return `This course was rebuilt from its stored decks for this version of cram.ai, and what was saved with it didn’t carry over: ${lost.join(', ')}.`;
};

export const progressMessage = (progress: UploadProgress): string => {
  switch (progress.state) {
    case 'queued':
      return 'Waiting to be read…';
    case 'ingesting':
      return 'Reading slides…';
    case 'summarising':
      return 'Summarising the lecture…';
    case 'indexed':
      return indexedMessage(progress);
    case 'unreadable':
      return `This deck couldn’t be read (${progress.reason}${progress.detail === '' ? '' : `: ${progress.detail}`}).`;
    case 'course-unavailable':
      return `${fileUnopened(progress.problem)}, so the deck was not indexed.`;
    case 'failed':
      return 'Something went wrong reading this deck. Upload it again.';
  }
};

export const withheldUnitMessage = (withheld: WithheldUnit): string => {
  switch (withheld.reason) {
    case 'dangling-citation':
      return 'It cites no slide line, or a line its slide doesn’t have, so it couldn’t be checked.';
    case 'unsupported':
      return 'The slides it cites don’t say it.';
    case 'partial':
      switch (withheld.policy) {
        case 'drop':
          return 'The slides it cites say only part of it, so it was left out.';
        case 'rewrite-once':
          return 'The slides it cites say only part of it, and a rewrite didn’t fix that.';
      }
  }
};

export const withheldHeading = (count: number): string => `Withheld (${String(count)})`;

export const droppedQuotesHeading = (count: number): string =>
  `Quote marks removed (${String(count)})`;
export const DROPPED_QUOTES_NOTE =
  'The answer marked these as quotes, but doesn’t repeat them word for word, or names a line its slide doesn’t have, so the marks were taken off. Taking a mark off removed no words.';

export const withheldMessage = (withheld: Exclude<WithheldSentence, DroppedPointer>): string => {
  switch (withheld.reason) {
    case 'contradicted':
      return 'A slide this answer was written from says otherwise.';
    case 'unsupported':
      return 'No slide this answer was written from says it.';
    case 'ungrounded':
      return 'No slide this answer was written from says any of it.';
  }
};
