import type { CourseId, LectureId, LectureSlides } from '@cram/shared';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type LectureSlidesState = { readonly status: 'pending' } | ApiResult<LectureSlides>;

/** Read once per lecture; `revision` reads it again after a failed read. */
export const useLectureSlides = (
  api: ApiClient,
  courseId: CourseId,
  lectureId: LectureId,
  revision: number,
): LectureSlidesState => {
  const [state, setState] = useState<LectureSlidesState>({ status: 'pending' });
  useEffect(() => {
    let current = true;
    void api.lectureSlides(courseId, lectureId).then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [api, courseId, lectureId, revision]);
  return state;
};
