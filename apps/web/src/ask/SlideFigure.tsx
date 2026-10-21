import type { SlideRecord } from '@cram/shared';
import { useState } from 'react';
import { slideImagePath } from '../api/api-client';
import { SLIDE_IMAGE_MISSING, slideImageAlt } from '../copy';
import { Empty } from '../shell/async-states';

/** The slide's stored rendering, in a frame that keeps its size when it can't load (PPTX: #169). */
export const SlideFigure = ({ record }: { readonly record: SlideRecord }) => {
  const [missing, setMissing] = useState(false);
  return (
    <div className="slide-figure">
      {missing ? (
        <Empty>{SLIDE_IMAGE_MISSING}</Empty>
      ) : (
        <img
          src={slideImagePath(record)}
          alt={slideImageAlt(record)}
          onError={() => {
            setMissing(true);
          }}
        />
      )}
    </div>
  );
};
