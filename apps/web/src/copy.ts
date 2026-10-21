import type {
  ApiRefusal,
  PartialPolicy,
  StoredLecture,
  UploadProgress,
  WithheldUnit,
} from '@cram/shared';
import type { ApiFailure } from './api/api-result';

/** The app's async-state and failure wording, in one place (`docs/standards/react.md` § Async surface convention). */
export const PENDING = {
  courses: 'Loading courses…',
  decks: 'Loading decks…',
  answer: 'Checking your slides…',
} as const;

/** The fixed system string for a question no surviving unit answers (`docs/standards/grounding.md` rule 5). */
export const NOT_COVERED = 'Your slides don’t cover this.';
export const CLOSEST_SLIDES = 'Closest slides';
export const SOURCE_MISSING = 'Source not returned';
export const SLIDE_HAS_NO_TEXT = 'This slide has no text to show.';

export const RETRY = 'Try again';
export const APP_FAILED = 'Something went wrong in cram.ai. Reload the page to start again.';
export const MODEL_FAILED = 'The model didn’t answer. Ask again in a moment.';
export const COURSE_NAME_REFUSED =
  'A course name needs at least one letter or digit, and can’t be a reserved device name.';

const refusalMessage = (refusal: ApiRefusal): string => {
  switch (refusal.status) {
    case 'bad-request':
      return `The server refused the request: ${refusal.issue}`;
    case 'course-unavailable':
      return `This course’s file can’t be opened (${refusal.problem}).`;
    case 'question-over-length':
      return `That question is too long for the model to read (at most ${String(refusal.maxInputTokens)} tokens). Shorten it and ask again.`;
    case 'no-such-course':
      return 'This course has no decks yet. Add one first.';
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
}: Pick<StoredLecture, 'slideCount' | 'imageOnly'>): string => {
  const indexed = `${String(slideCount)} ${slideCount === 1 ? 'slide' : 'slides'} indexed.`;
  return imageOnly.length === 0
    ? indexed
    : `${indexed} ${slidesThat(imageOnly, 'has no text, so it', 'have no text, so they')} can’t be cited yet.`;
};

/** Why the course file's lectures are not listed; this session's uploads still are. */
export const storedUnavailableMessage = (problem: string): string =>
  `This course’s file can’t be opened (${problem}), so its stored decks can’t be listed.`;

export const progressMessage = (progress: UploadProgress): string => {
  switch (progress.state) {
    case 'queued':
      return 'Waiting to be read…';
    case 'ingesting':
      return 'Reading slides…';
    case 'indexed':
      return indexedMessage(progress);
    case 'unreadable':
      return `This deck couldn’t be read (${progress.reason}${progress.detail === '' ? '' : `: ${progress.detail}`}).`;
    case 'over-length':
      return `${slidesThat(progress.slides, 'holds', 'hold')} more text than the model reads at once (${String(progress.maxInputTokens)} tokens), so nothing from this deck was indexed.`;
    case 'course-unavailable':
      return `This course’s file can’t be opened (${progress.problem}), so the deck was not indexed.`;
    case 'failed':
      return 'Something went wrong reading this deck. Upload it again.';
  }
};

const PARTIAL_MESSAGE: Readonly<Record<PartialPolicy, string>> = {
  drop: 'The cited slides only partly support it.',
  'rewrite-once': 'The cited slides only partly support it, even after one rewrite.',
};

/** Why a unit was withheld, one sentence per `WithheldReason` (`docs/standards/grounding.md` rule 7). */
export const withheldMessage = (withheld: WithheldUnit): string => {
  switch (withheld.reason) {
    case 'dangling-citation':
      return 'It cites no slide, or one of its citations names a slide not retrieved for this question or quotes words that slide doesn’t contain.';
    case 'unsupported':
      return 'The cited slides don’t support it.';
    case 'partial':
      return PARTIAL_MESSAGE[withheld.policy];
  }
};
