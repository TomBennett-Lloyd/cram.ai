import type { CourseList } from '@cram/shared';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/api-client';
import type { ApiResult } from '../api/api-result';

export type CoursesState = { readonly status: 'pending' } | ApiResult<CourseList>;

/** The course list, read on mount and again whenever `revision` moves (a retry). */
export const useCourses = (api: ApiClient, revision: number): CoursesState => {
  const [state, setState] = useState<CoursesState>({ status: 'pending' });
  useEffect(() => {
    let current = true;
    setState({ status: 'pending' });
    void api.courses().then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [api, revision]);
  return state;
};
