import type { SourceId } from '@cram/shared';
import type { RefObject } from 'react';
import { SOURCE_MISSING, SOURCES } from '../copy';
import type { CitedSlide } from './cited-slide';
import { SlideCard } from './SlideCard';

/** Every slide an explanation names, numbered in `sources` order; each entry opens its slide. */
export const SourcesList = ({
  sources,
  cite,
  entries,
  onOpen,
}: {
  readonly sources: readonly SourceId[];
  readonly cite: (sourceId: SourceId) => CitedSlide | undefined;
  readonly entries: RefObject<Map<SourceId, HTMLButtonElement>>;
  readonly onOpen: (cited: CitedSlide) => void;
}) => (
  <ol className="sources" aria-label={SOURCES}>
    {sources.map((sourceId, index) => {
      const cited = cite(sourceId);
      return (
        <li key={sourceId} className="sources-entry">
          <span className="sources-number">{index + 1}</span>
          {cited === undefined ? (
            <span className="citation-missing">{SOURCE_MISSING}</span>
          ) : (
            <SlideCard
              slide={cited.slide}
              ref={(node) => {
                if (node !== null) entries.current.set(sourceId, node);
                return () => {
                  entries.current.delete(sourceId);
                };
              }}
              onOpen={() => {
                onOpen(cited);
              }}
            />
          )}
        </li>
      );
    })}
  </ol>
);
