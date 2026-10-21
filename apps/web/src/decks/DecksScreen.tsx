import type { CourseId, IngestStatus, StoredLecture, Upload } from '@cram/shared';
import { type ChangeEvent, useState } from 'react';
import { useApi } from '../api/api-context';
import type { ApiClient } from '../api/api-client';
import { DECK_FILE_ACCEPT, deckMediaType, lectureIdOf } from '../api/deck-file';
import {
  failureMessage,
  indexedMessage,
  PENDING,
  progressMessage,
  storedUnavailableMessage,
} from '../copy';
import { Empty, Failed, Pending } from '../shell/async-states';
import { useIngestStatus } from './use-ingest-status';

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
  const state = useIngestStatus(api, courseId, revision);
  const reread = (): void => {
    setRevision((value) => value + 1);
  };
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
    ...(state.status === 'ready' && state.ingest.stored.state === 'course-unavailable'
      ? [storedUnavailableMessage(state.ingest.stored.problem)]
      : []),
  ];
  return (
    <main className="screen">
      <div className="file-picker">
        <label htmlFor="deck-files">Add decks</label>
        <input id="deck-files" type="file" accept={DECK_FILE_ACCEPT} multiple onChange={onChange} />
      </div>
      {messages.length > 0 && (
        <Failed
          key={revision}
          messages={messages}
          onRetry={state.status === 'failed' ? reread : undefined}
        />
      )}
      {state.status === 'pending' ? (
        <Pending label={PENDING.decks} />
      ) : (
        state.status === 'ready' && <DeckList ingest={state.ingest} />
      )}
    </main>
  );
};
