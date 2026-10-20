import type { CourseId, Upload } from '@cram/shared';
import { type ChangeEvent, useState } from 'react';
import { useApi } from '../api/api-context';
import type { ApiClient } from '../api/api-client';
import { deckMediaType, lectureIdOf } from '../api/deck-file';
import { failureMessage, PENDING, progressMessage } from '../copy';
import { Empty, Failed, Pending } from '../shell/async-states';
import { useIngestStatus } from './use-ingest-status';

const DECK_TYPES = '.pdf,.pptx';

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

const UploadList = ({ uploads }: { readonly uploads: readonly Upload[] }) =>
  uploads.length === 0 ? (
    <Empty>No decks yet. Add this course’s lecture slides as PDF or PowerPoint files.</Empty>
  ) : (
    <ul className="upload-list">
      {uploads.map((upload) => (
        <li key={upload.uploadId} className="upload" data-state={upload.progress.state}>
          <span className="upload-file">{upload.fileName}</span>
          <span className="upload-progress">{progressMessage(upload.progress)}</span>
        </li>
      ))}
    </ul>
  );

export const DecksScreen = ({ courseId }: { readonly courseId: CourseId }) => {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const [refused, setRefused] = useState<readonly Refused[]>([]);
  const state = useIngestStatus(api, courseId, revision);
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = '';
    void uploadAll(api, courseId, files).then((next) => {
      setRefused(next);
      setRevision((value) => value + 1);
    });
  };
  return (
    <main className="screen">
      <div className="file-picker">
        <label htmlFor="deck-files">Add decks</label>
        <input id="deck-files" type="file" accept={DECK_TYPES} multiple onChange={onChange} />
      </div>
      {refused.map(({ fileName, message }) => (
        <Failed key={fileName} message={`${fileName}: ${message}`} />
      ))}
      {state.status === 'pending' ? (
        <Pending label={PENDING.decks} />
      ) : state.status === 'ready' ? (
        <UploadList uploads={state.uploads} />
      ) : (
        <Failed message={failureMessage(state.failure)} />
      )}
    </main>
  );
};
