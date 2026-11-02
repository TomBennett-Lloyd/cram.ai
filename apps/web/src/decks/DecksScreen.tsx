import type {
  CourseId,
  IngestStatus,
  LectureId,
  RebuildReportRevision,
  StoredLecture,
  Upload,
} from '@cram/shared';
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
import type { CitedSlide } from '../ask/cited-slide';
import { SlideDialog } from '../ask/SlideDialog';
import { type Dismissible, Empty, Failed, Pending } from '../shell/async-states';
import { NoSummary, SummaryDetails } from './LectureSummary';
import { remaking, repairing, useIngestStatus } from './use-ingest-status';
import { type SummariesState, useSummaries } from './use-summaries';

/** Where dismissing the rebuild report has got to; a refused or failed call is reported in the alert. */
type Dismissal =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'dismissed'; readonly revision: RebuildReportRevision }
  | ApiFailure;

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

/** A stored lecture with an upload this session past its indexing is left to that upload's row, which names its file. */
const unlistedLectures = (
  lectures: readonly StoredLecture[],
  uploads: readonly Upload[],
): readonly StoredLecture[] => {
  const indexed = new Set(
    uploads
      .filter(({ progress }) => progress.state === 'indexed' || progress.state === 'summarising')
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

type Ingest = Omit<IngestStatus, 'courseId'>;

/** What the decks screen does for a lecture's summary: read the lines, open a slide, make one again. */
interface SummaryActs {
  readonly summaries: SummariesState;
  readonly loadSummaries: () => void;
  readonly onOpen: (cited: CitedSlide) => void;
  readonly requested: ReadonlySet<LectureId>;
  readonly onRemake: (lectureId: LectureId) => void;
}

/** Changes whenever a stored summary may have, so lines read before it are read again. */
const summaryStamp = ({ stored, uploads, remakes }: Ingest): string =>
  JSON.stringify([
    stored.state === 'read'
      ? stored.lectures.map(({ lectureId, summarised }) => [lectureId, summarised])
      : [],
    uploads.map(({ uploadId, progress }) => [uploadId, progress.state]),
    remakes.map(({ lectureId, progress }) => [lectureId, progress.state]),
  ]);

/** The lecture's summary lines, or why it has none; a lecture the file does not list has neither. */
const SummaryArea = ({
  lectureId,
  ingest,
  acts,
}: {
  readonly lectureId: LectureId;
  readonly ingest: Ingest;
  readonly acts: SummaryActs;
}) => {
  const { stored, uploads, remakes } = ingest;
  const lecture =
    stored.state === 'read'
      ? stored.lectures.find((each) => each.lectureId === lectureId)
      : undefined;
  if (lecture === undefined) return null;
  if (lecture.summarised)
    return (
      <SummaryDetails
        lectureId={lectureId}
        state={acts.summaries}
        onLoad={acts.loadSummaries}
        onOpen={acts.onOpen}
      />
    );
  const remake = remakes.find((each) => each.lectureId === lectureId)?.progress;
  const tried =
    remake !== undefined ||
    uploads.some((upload) => upload.lectureId === lectureId && upload.progress.state === 'indexed');
  return (
    <NoSummary
      busy={acts.requested.has(lectureId) || (remake !== undefined && remaking(remake))}
      tried={tried}
      onRemake={() => {
        acts.onRemake(lectureId);
      }}
    />
  );
};

const DeckList = ({ ingest, acts }: { readonly ingest: Ingest; readonly acts: SummaryActs }) => {
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
          <SummaryArea lectureId={lecture.lectureId} ingest={ingest} acts={acts} />
        </li>
      ))}
      {uploads.map((upload) => (
        <li key={upload.uploadId} className="upload" data-state={upload.progress.state}>
          <span className="upload-file">{upload.fileName}</span>
          <span className="upload-progress">{progressMessage(upload.progress)}</span>
          {upload.progress.state === 'indexed' && (
            <SummaryArea lectureId={upload.lectureId} ingest={ingest} acts={acts} />
          )}
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
  const [requested, setRequested] = useState<ReadonlySet<LectureId>>(new Set());
  const [remakeFailure, setRemakeFailure] = useState<ApiFailure | undefined>(undefined);
  const [open, setOpen] = useState<CitedSlide | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const state = useIngestStatus(api, courseId, revision);
  const summaries = useSummaries(
    api,
    courseId,
    state.status === 'ready' ? summaryStamp(state.ingest) : '',
  );
  const reread = (): void => {
    setRevision((value) => value + 1);
  };
  /** The request's answer is the re-make's queued state, which the re-read that follows shows. */
  const remake = (lectureId: LectureId): void => {
    setRequested((held) => new Set([...held, lectureId]));
    setRemakeFailure(undefined);
    void api.remakeSummary(courseId, lectureId).then((result) => {
      setRequested((held) => new Set([...held].filter((each) => each !== lectureId)));
      if (result.status !== 'ok') setRemakeFailure(result);
      reread();
    });
  };
  const acts: SummaryActs = {
    summaries: summaries.state,
    loadSummaries: summaries.load,
    onOpen: setOpen,
    requested,
    onRemake: remake,
  };
  /**
   * The server's report is empty once it answers, so the notice is hidden rather than re-read: a
   * re-read remounts the alert, which would announce the notice again. Its button goes with it, so
   * the focus lands on the screen's next act, the picker, unless the reader has moved it since the
   * press (`docs/standards/design.md` rule 11). The answer waits behind every queued upload. A
   * report other than the one shown is re-read, so the student sees it before dismissing it (#299).
   */
  const dismiss = (shown: RebuildReportRevision): void => {
    const pressed = document.activeElement;
    setDismissal({ status: 'pending' });
    void api.dismissRebuildReport(courseId, shown).then((result) => {
      const held = document.activeElement;
      if (result.status === 'ok' && (held === pressed || held === document.body))
        picker.current?.focus();
      if (result.status === 'refused' && result.refusal.status === 'report-changed') reread();
      setDismissal(result.status === 'ok' ? { status: 'dismissed', revision: shown } : result);
    });
  };
  const report =
    state.status === 'ready' && state.ingest.stored.state === 'read'
      ? state.ingest.stored.report
      : undefined;
  /** A revision names rows a later rebuild can record again, so a read showing none forgets it, in render (`docs/standards/react.md` rule 1). */
  if (dismissal.status === 'dismissed' && report?.state === 'none')
    setDismissal({ status: 'idle' });
  const lost: Dismissible | undefined =
    report?.state === 'undismissed' &&
    !(dismissal.status === 'dismissed' && dismissal.revision === report.revision)
      ? {
          message: discardedMessage(report.discarded),
          onDismiss:
            dismissal.status === 'pending'
              ? undefined
              : () => {
                  dismiss(report.revision);
                },
        }
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
    ...(dismissal.status === 'idle' ||
    dismissal.status === 'pending' ||
    dismissal.status === 'dismissed'
      ? []
      : [failureMessage(dismissal)]),
    ...(remakeFailure === undefined ? [] : [failureMessage(remakeFailure)]),
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
      {dismissal.status === 'pending' && <Pending label={PENDING.dismissal} />}
      {state.status === 'ready' && awaitingRepair(state.ingest) && (
        <Pending label={PENDING.repair} />
      )}
      {state.status === 'pending' ? (
        <Pending label={PENDING.decks} />
      ) : (
        state.status === 'ready' && <DeckList ingest={state.ingest} acts={acts} />
      )}
      {open !== null && (
        <SlideDialog
          cited={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </main>
  );
};
