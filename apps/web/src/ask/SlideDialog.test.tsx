import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOLLOWMERE_QUEEN, HOLLOWMERE_COMB_CHART } from '../api/api-fixture';
import { DERIVED_TEXT, SLIDE_HAS_NO_TEXT, SLIDE_IMAGE_MISSING, SLIDE_LINES } from '../copy';
import type { CitedSlide } from './cited-slide';
import { SlideDialog } from './SlideDialog';

const open = (cited: CitedSlide) => render(<SlideDialog cited={cited} onClose={() => undefined} />);

const panel = () => screen.getByRole('dialog');
const lines = () =>
  within(within(panel()).getByRole('list', { name: SLIDE_LINES }))
    .getAllByRole('listitem')
    .map((item) =>
      [...item.childNodes]
        .map((node) =>
          node instanceof HTMLElement && node.tagName === 'MARK'
            ? `[${node.textContent}]`
            : node.textContent,
        )
        .join(''),
    );

describe('SlideDialog', () => {
  it('shows the slide’s stored image, read from its own route', () => {
    open({ slide: HOLLOWMERE_QUEEN, quotes: [] });
    const image = within(panel()).getByRole('img');
    expect(image.getAttribute('src')).toBe(
      '/courses/hollowmere/slide-image?lectureId=lecture-01&slideNo=2',
    );
    expect(image.getAttribute('alt')).toBe(
      'Slide 2 of The colony and its castes, as rendered from its deck',
    );
  });

  it('lists each line ingest separated, with the quoted ones marked', () => {
    open({ slide: HOLLOWMERE_QUEEN, quotes: ["The queen is the colony's only female"] });
    expect(lines()).toEqual([
      'One queen per colony',
      "[The queen is the colony's only female]",
      'She lays up to 1,500 eggs a day at the height of summer',
      'She is fed on royal jelly throughout her life',
    ]);
  });

  it('marks both parts of a quote that runs across a line break', () => {
    open({ slide: HOLLOWMERE_QUEEN, quotes: ['per colony The queen'] });
    expect(lines().slice(0, 2)).toEqual([
      'One queen [per colony]',
      "[The queen] is the colony's only female",
    ]);
  });

  it('labels derived text where it is shown beside its image (ADR 0006 § Decision (f))', () => {
    open({
      slide: { ...HOLLOWMERE_QUEEN, record: { ...HOLLOWMERE_QUEEN.record, derived: true } },
      quotes: [],
    });
    expect(within(panel()).getByText(DERIVED_TEXT)).toBeDefined();
  });

  it('labels no typed slide derived', () => {
    open({ slide: HOLLOWMERE_QUEEN, quotes: [] });
    expect(within(panel()).queryByText(DERIVED_TEXT)).toBeNull();
  });

  it('shows an image-only slide of the synthetic deck, as ingest stores it with no OCR, and says it has no text', () => {
    open({ slide: HOLLOWMERE_COMB_CHART, quotes: [] });
    expect(within(panel()).getByRole('img')).toBeDefined();
    expect(panel().textContent).toContain(SLIDE_HAS_NO_TEXT);
    expect(within(panel()).queryByRole('list')).toBeNull();
  });

  it('says the picture can’t be shown, in the same frame, when the image fails to load', () => {
    open({ slide: HOLLOWMERE_QUEEN, quotes: [] });
    fireEvent.error(within(panel()).getByRole('img'));
    expect(within(panel()).queryByRole('img')).toBeNull();
    expect(panel().querySelector('.slide-figure')?.textContent).toBe(SLIDE_IMAGE_MISSING);
    expect(panel().textContent).toContain(SLIDE_IMAGE_MISSING);
    expect(lines()).toHaveLength(4);
  });
});
