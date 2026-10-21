import type { SlideRecord } from '@cram/shared';
import { useState } from 'react';
import { slideImagePath } from '../api/api-client';
import { SLIDE_IMAGE_MISSING, slideImageAlt } from '../copy';
import { Empty } from '../shell/async-states';

/** The slide's stored rendering, or that none is stored: a PPTX deck has none yet (#169). */
export const SlideFigure = ({ record }: { readonly record: SlideRecord }) => {
  const [missing, setMissing] = useState(false);
  return missing ? (
    <Empty>{SLIDE_IMAGE_MISSING}</Empty>
  ) : (
    <img
      className="slide-figure"
      src={slideImagePath(record)}
      alt={slideImageAlt(record)}
      onError={() => {
        setMissing(true);
      }}
    />
  );
};
