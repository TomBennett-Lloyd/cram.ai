import type { CourseId, LectureId } from '@cram/shared';
import { hrefOf } from '../shell/route';

/** A deck's row name, linked to its lecture's slide browser once the lecture is stored. */
export const LectureName = ({
  courseId,
  lectureId,
  linked,
  children,
}: {
  readonly courseId: CourseId;
  readonly lectureId: LectureId;
  readonly linked: boolean;
  readonly children: string;
}) =>
  linked ? (
    <a className="upload-file" href={hrefOf({ screen: 'slides', courseId, lectureId })}>
      {children}
    </a>
  ) : (
    <span className="upload-file">{children}</span>
  );
