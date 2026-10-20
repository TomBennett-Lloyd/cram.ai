import type { CourseList } from '@cram/shared';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type CoursesState = { readonly status: 'pending' } | ApiResult<CourseList>;

/** The course list, read once per mount. */
export const useCourses = (api: ApiClient): CoursesState => {
  const [state, setState] = useState<CoursesState>({ status: 'pending' });
  useEffect(() => {
    let current = true;
    void api.courses().then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [api]);
  return state;
};
