import type { CourseId, IngestStatus, StoredLecture, Upload } from '@cram/shared';
import { type ChangeEvent, useRef, useState } from 'react';
import { useApi } from '../api/api-context';
import type { ApiClient } from '../api/api-client';
import type { ApiFailure } from '../api/api-result';
import { DECK_FILE_ACCEPT, deckMediaType, lectureIdOf } from '../api/deck-file';
import {
  discardedMessage,
  failureMessage,
  indexedMessage,
  PENDING,
  progressMessage,
  repairFailedMessage,
  storedUnavailableMessage,
} from '../copy';
import { type Dismissible, Empty, Failed, Pending } from '../shell/async-states';
import { repairing, useIngestStatus } from './use-ingest-status';

/** Where dismissing the rebuild report has got to; a refused or failed call is reported in the alert. */
type Dismissal = { readonly status: 'idle' } | { readonly status: 'dismissed' } | ApiFailure;

interface Refused {
  readonly fileName: string;
  readonly message: string;
}

/** Uploads one at a time, in the order picked, and reports each file the server refused. */
const uploadAll = async (
  api: ApiClient,
  courseId: CourseId,
  files: readonly File[],
): Promise<Refused[]> => {
  const refused: Refused[] = [];
  for (const file of files) {
    const deck = { file, lectureId: lectureIdOf(file.name), mediaType: deckMediaType(file.name) };
    const result = await api.uploadDeck(courseId, deck);
    if (result.status !== 'ok')
      refused.push({ fileName: file.name, message: failureMessage(result) });
  }
  return refused;
};

/** A stored lecture with an `indexed` upload this session is left to that upload's row, which names its file. */
const unlistedLectures = (
  lectures: readonly StoredLecture[],
  uploads: readonly Upload[],
): readonly StoredLecture[] => {
  const indexed = new Set(
    uploads
      .filter(({ progress }) => progress.state === 'indexed')
      .map(({ lectureId }) => lectureId),
  );
  return lectures.filter(({ lectureId }) => !indexed.has(lectureId));
};

/** Why the course file's lectures are missing, once no repair is still under way. */
const storedMessages = ({ stored, repair }: Omit<IngestStatus, 'courseId'>): readonly string[] => {
  if (stored.state === 'read' || repairing(repair)) return [];
  const { problem } = stored;
  return [
    repair.state === 'failed' ? repairFailedMessage(problem) : storedUnavailableMessage(problem),
  ];
};

const awaitingRepair = ({ stored, repair }: Omit<IngestStatus, 'courseId'>): boolean =>
  stored.state === 'course-unavailable' && repairing(repair);

const DeckList = ({ ingest }: { readonly ingest: Omit<IngestStatus, 'courseId'> }) => {
  const { stored, uploads } = ingest;
  const lectures = stored.state === 'read' ? unlistedLectures(stored.lectures, uploads) : [];
  if (lectures.length === 0 && uploads.length === 0)
    return stored.state === 'read' ? (
      <Empty>No decks yet. Add this course’s lecture slides as PDF or PowerPoint files.</Empty>
    ) : null;
  return (
    <ul className="upload-list">
      {lectures.map((lecture) => (
        <li key={`lecture:${lecture.lectureId}`} className="upload" data-state="indexed">
          <span className="upload-file">{lecture.lectureId}</span>
          <span className="upload-progress">{indexedMessage(lecture)}</span>
        </li>
      ))}
      {uploads.map((upload) => (
        <li key={upload.uploadId} className="upload" data-state={upload.progress.state}>
          <span className="upload-file">{upload.fileName}</span>
          <span className="upload-progress">{progressMessage(upload.progress)}</span>
        </li>
      ))}
    </ul>
  );
};

export const DecksScreen = ({ courseId }: { readonly courseId: CourseId }) => {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const [refused, setRefused] = useState<readonly Refused[]>([]);
  const [dismissal, setDismissal] = useState<Dismissal>({ status: 'idle' });
  const picker = useRef<HTMLInputElement>(null);
  const state = useIngestStatus(api, courseId, revision);
  const reread = (): void => {
    setRevision((value) => value + 1);
  };
  /**
   * The server's report is empty once it answers, so the notice is hidden rather than re-read: a
   * re-read remounts the alert, which would announce the notice again. Its button goes with it, so
   * the focus lands on the screen's next act, the picker (`docs/standards/design.md` rule 11).
   */
  const dismiss = (): void => {
    void api.dismissRebuildReport(courseId).then((result) => {
      setDismissal(result.status === 'ok' ? { status: 'dismissed' } : result);
      if (result.status === 'ok') picker.current?.focus();
    });
  };
  const stored = state.status === 'ready' ? state.ingest.stored : undefined;
  const lost: Dismissible | undefined =
    dismissal.status !== 'dismissed' && stored?.state === 'read' && stored.discarded.length > 0
      ? { message: discardedMessage(stored.discarded), onDismiss: dismiss }
      : undefined;
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = '';
    void uploadAll(api, courseId, files).then((next) => {
      setRefused(next);
      setRevision((value) => value + 1);
    });
  };
  const messages = [
    ...refused.map(({ fileName, message }) => `${fileName}: ${message}`),
    ...(state.status === 'failed' ? [failureMessage(state.failure)] : []),
    ...(dismissal.status === 'idle' || dismissal.status === 'dismissed'
      ? []
      : [failureMessage(dismissal)]),
    ...(state.status === 'ready' ? storedMessages(state.ingest) : []),
  ];
  return (
    <main className="screen">
      <div className="file-picker">
        <label htmlFor="deck-files">Add decks</label>
        <input
          ref={picker}
          id="deck-files"
          type="file"
          accept={DECK_FILE_ACCEPT}
          multiple
          onChange={onChange}
        />
      </div>
      {(messages.length > 0 || lost !== undefined) && (
        <Failed
          key={revision}
          messages={messages}
          dismissible={lost}
          onRetry={state.status === 'failed' ? reread : undefined}
        />
      )}
      {state.status === 'ready' && awaitingRepair(state.ingest) && (
        <Pending label={PENDING.repair} />
      )}
      {state.status === 'pending' ? (
        <Pending label={PENDING.decks} />
      ) : (
        state.status === 'ready' && <DeckList ingest={state.ingest} />
      )}
    </main>
  );
};
