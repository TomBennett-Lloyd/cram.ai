import {
  type Explanation,
  type RetrievedSlide,
  SourceId,
  type VerificationDepth,
} from '@cram/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMB, CONTRADICTED, GROUNDED, HIVE, retrievedSlide, sentence } from '../api/api-fixture';
import {
  APPEARS_TO_CONTRADICT,
  ATTRIBUTED_NOTE,
  contradictionRefLabel,
  DERIVED_SOURCE,
  MAY_BE_RELEVANT,
  SOURCE_MISSING,
  sourceRefLabel,
} from '../copy';
import { ExplanationView } from './ExplanationView';

const id = (value: string) => SourceId.parse(value);

interface Shown {
  readonly depth?: VerificationDepth;
  readonly slides?: readonly RetrievedSlide[];
}

const show = (
  explanation: Explanation,
  { depth = 'light', slides = GROUNDED.slides }: Shown = {},
) =>
  render(
    <ExplanationView
      explanation={explanation}
      slides={slides}
      depth={depth}
      onOpen={() => undefined}
    />,
  ).container;

/** Each reference button's visible number and accessible name, in document order. */
const refsIn = (scope: Element) =>
  [...scope.querySelectorAll('.source-ref')].map((ref) => [
    ref.textContent,
    ref.getAttribute('aria-label'),
  ]);

const sourcesEntries = () =>
  within(screen.getByRole('list', { name: 'Sources' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('ExplanationView', () => {
  it('shows the explanation as prose, each sentence’s numbers under the label, the note and the sources beneath', () => {
    const view = show(GROUNDED.explanation);
    const text = view.querySelector('.explanation-text');
    expect(text?.textContent).toBe(
      `Workers are female. ${MAY_BE_RELEVANT}1 Drones are male, and comb cells are hexagonal. ${MAY_BE_RELEVANT}12 `,
    );
    expect(refsIn(text ?? document.body)).toEqual([
      ['1', sourceRefLabel(1, HIVE.record)],
      ['1', sourceRefLabel(1, HIVE.record)],
      ['2', sourceRefLabel(2, COMB.record)],
    ]);
    expect(screen.getByText(ATTRIBUTED_NOTE)).toBeDefined();
    expect(sourcesEntries()).toEqual([
      '1Lecture 1: The HiveSlide 4Castes',
      '2Lecture 1: The HiveSlide 7The comb',
    ]);
    expect(view.querySelector('.contradicted, .contradiction-refs')).toBeNull();
  });

  it('shows each paragraph of the text as its own, each sentence’s marks and numbers in its paragraph', () => {
    const view = show({
      ...CONTRADICTED,
      text: 'Workers are female.\n\nDrones forage for nectar.',
    });
    const paragraphs = [...(view.querySelector('.explanation-text')?.children ?? [])];
    expect(paragraphs.map((paragraph) => [paragraph.tagName, paragraph.textContent])).toEqual([
      ['P', `Workers are female. ${MAY_BE_RELEVANT}1 `],
      ['P', `Drones forage for nectar. 1${APPEARS_TO_CONTRADICT} ${MAY_BE_RELEVANT}2 `],
    ]);
    expect(paragraphs[1]?.querySelector('.contradicted')?.textContent).toBe(
      'Drones forage for nectar.',
    );
    expect(sourcesEntries()).toHaveLength(2);
  });

  it('keeps sentences a single line ending separates in one paragraph', () => {
    const view = show({ ...CONTRADICTED, text: 'Workers are female.\nDrones forage for nectar.' });
    expect(view.querySelectorAll('.explanation-text > p')).toHaveLength(1);
  });

  it('numbers each slide by first use, across sentences', () => {
    const view = show({
      text: 'Cells are hexagonal. Workers are female, in hexagonal cells.',
      quotes: [],
      sentences: [
        sentence('Cells are hexagonal.', ['s2']),
        sentence('Workers are female, in hexagonal cells.', ['s1', 's2']),
      ],
      sources: [id('s2'), id('s1')],
    });
    expect(refsIn(view).map(([number]) => number)).toEqual(['1', '2', '1']);
    expect(sourcesEntries()).toEqual([
      '1Lecture 1: The HiveSlide 7The comb',
      '2Lecture 1: The HiveSlide 4Castes',
    ]);
  });

  it('marks a quote crossing a sentence boundary in both sentences, its number once, after the second', () => {
    const view = show({
      text: 'Worker bees are female. Drones are male.',
      quotes: [{ sourceId: id('s1'), quote: 'female. Drones are male.' }],
      sentences: [sentence('Worker bees are female.', []), sentence('Drones are male.', [])],
      sources: [id('s1')],
    });
    const quotes = [...view.querySelectorAll('q.explanation-quote')];
    expect(quotes.map((quote) => quote.textContent)).toEqual(['female.', 'Drones are male.']);
    expect(quotes[1]?.nextElementSibling?.textContent).toBe('1');
    expect(refsIn(view)).toEqual([['1', sourceRefLabel(1, HIVE.record)]]);
  });

  it('follows a line two slides hold with both their numbers', () => {
    const view = show({
      text: 'Workers are female.',
      quotes: [
        { sourceId: id('s1'), quote: 'female' },
        { sourceId: id('s2'), quote: 'female' },
      ],
      sentences: [sentence('Workers are female.', [])],
      sources: [id('s1'), id('s2')],
    });
    expect(view.querySelector('.explanation-text')?.textContent).toBe('Workers are female12. ');
  });

  it('shows no reference cluster after a sentence no search found a slide for', () => {
    const view = show({
      text: 'Workers are female. Bees are insects.',
      quotes: [],
      sentences: [sentence('Workers are female.', ['s1']), sentence('Bees are insects.', [])],
      sources: [id('s1')],
    });
    expect(view.querySelectorAll('.sentence-refs')).toHaveLength(1);
    expect(view.querySelector('.explanation-text')?.textContent).toMatch(/Bees are insects\. $/);
  });

  it('marks a contradicted sentence, its contradiction numbers before its other slides, a slide in both once', () => {
    const view = show(CONTRADICTED);
    const marked = view.querySelectorAll('.contradicted');
    expect([...marked].map((span) => span.textContent)).toEqual(['Drones forage for nectar.']);
    const contradiction = marked[0]?.nextElementSibling;
    expect(contradiction?.classList.contains('contradiction-refs')).toBe(true);
    expect(refsIn(contradiction ?? document.body)).toEqual([
      ['1', contradictionRefLabel(1, HIVE.record)],
    ]);
    const label = contradiction?.lastElementChild;
    expect(label?.classList.contains('contradiction-label')).toBe(true);
    expect(label?.textContent).toBe(APPEARS_TO_CONTRADICT);
    expect(label?.getAttribute('aria-hidden')).toBe('true');
    const others = contradiction?.nextElementSibling;
    expect(others?.classList.contains('sentence-refs')).toBe(true);
    expect(refsIn(others ?? document.body)).toEqual([['2', sourceRefLabel(2, COMB.record)]]);
    expect(
      screen.getByRole('button', { name: contradictionRefLabel(1, HIVE.record) }),
    ).toBeDefined();
  });

  it('separates each cluster from the words before it', () => {
    const view = show(CONTRADICTED);
    expect(view.querySelector('.explanation-text')?.textContent).toBe(
      `Workers are female. ${MAY_BE_RELEVANT}1 Drones forage for nectar. 1${APPEARS_TO_CONTRADICT} ${MAY_BE_RELEVANT}2 `,
    );
  });

  it('says a source is missing where a slide the reply lacks would be, in the text and in the list', () => {
    const view = show(
      { ...CONTRADICTED, sources: [id('s1'), id('s2'), id('s9')] },
      { slides: [COMB] },
    );
    expect(view.querySelector('.contradiction-refs')?.textContent).toBe(
      `${SOURCE_MISSING}${APPEARS_TO_CONTRADICT}`,
    );
    expect(sourcesEntries()).toEqual([
      `1${SOURCE_MISSING}`,
      '2Lecture 1: The HiveSlide 7The comb',
      `3${SOURCE_MISSING}`,
    ]);
  });

  it('labels a sources entry whose text was read from the slide’s picture', () => {
    const derived = retrievedSlide('s1', { slideNo: 4, title: 'Castes', derived: true });
    show(GROUNDED.explanation, { slides: [derived, COMB] });
    expect(sourcesEntries()).toEqual([
      `1Lecture 1: The HiveSlide 4Castes${DERIVED_SOURCE}`,
      '2Lecture 1: The HiveSlide 7The comb',
    ]);
  });

  describe('a slide read from its picture (`docs/standards/grounding.md` rule 10)', () => {
    const DERIVED_HIVE = retrievedSlide('s1', { slideNo: 4, title: 'Castes', derived: true });
    const DERIVED_COMB = retrievedSlide('s2', { slideNo: 7, title: 'The comb', derived: true });
    const marked = (elements: Iterable<Element>) =>
      [...elements].map((element) => [element.textContent, element.hasAttribute('data-derived')]);

    it('marks its quotation and every number naming it, each number named with the derived label', () => {
      const view = show(
        {
          text: 'Drones are male. Cells are hexagonal.',
          quotes: [
            { sourceId: id('s1'), quote: 'Drones are male.' },
            { sourceId: id('s2'), quote: 'Cells are hexagonal.' },
          ],
          sentences: [
            sentence('Drones are male.', ['s1']),
            sentence('Cells are hexagonal.', ['s2']),
          ],
          sources: [id('s1'), id('s2')],
        },
        { slides: [DERIVED_HIVE, COMB] },
      );
      expect(marked(view.querySelectorAll('q.explanation-quote'))).toEqual([
        ['Drones are male.', true],
        ['Cells are hexagonal.', false],
      ]);
      expect(marked(view.querySelectorAll('.source-ref'))).toEqual([
        ['1', true],
        ['1', true],
        ['2', false],
        ['2', false],
      ]);
      expect(
        screen.getAllByRole('button', {
          name: `Source 1: Lecture 1: The Hive, slide 4. ${DERIVED_SOURCE}`,
        }),
      ).toHaveLength(2);
      expect(
        screen.getAllByRole('button', { name: 'Source 2: Lecture 1: The Hive, slide 7' }),
      ).toHaveLength(2);
    });

    it.each([
      ['the second', [HIVE, DERIVED_COMB], [false, true]],
      ['the first', [DERIVED_HIVE, COMB], [true, false]],
    ] as const)(
      'marks a line two slides hold when %s is derived, and each number for its own slide',
      (_, slides, numbers) => {
        const view = show(
          {
            text: 'Workers are female.',
            quotes: [
              { sourceId: id('s1'), quote: 'female' },
              { sourceId: id('s2'), quote: 'female' },
            ],
            sentences: [sentence('Workers are female.', [])],
            sources: [id('s1'), id('s2')],
          },
          { slides },
        );
        expect(marked(view.querySelectorAll('q.explanation-quote'))).toEqual([['female', true]]);
        expect(marked(view.querySelectorAll('.source-ref'))).toEqual([
          ['1', numbers[0]],
          ['2', numbers[1]],
        ]);
      },
    );

    it('marks both parts of a quotation crossing a sentence boundary', () => {
      const view = show(
        {
          text: 'Worker bees are female. Drones are male.',
          quotes: [{ sourceId: id('s1'), quote: 'female. Drones are male.' }],
          sentences: [sentence('Worker bees are female.', []), sentence('Drones are male.', [])],
          sources: [id('s1')],
        },
        { slides: [DERIVED_HIVE] },
      );
      expect(marked(view.querySelectorAll('q.explanation-quote'))).toEqual([
        ['female.', true],
        ['Drones are male.', true],
      ]);
    });

    it('marks a contradiction number naming it, and names it with both labels', () => {
      const view = show(CONTRADICTED, { slides: [DERIVED_HIVE, COMB] });
      const contradiction = view.querySelector('.contradiction-refs') ?? document.body;
      expect(marked(contradiction.querySelectorAll('.source-ref'))).toEqual([['1', true]]);
      expect(refsIn(contradiction)).toEqual([
        ['1', `Source 1: ${APPEARS_TO_CONTRADICT} Lecture 1: The Hive, slide 4. ${DERIVED_SOURCE}`],
      ]);
      expect(marked(view.querySelectorAll('.sentence-refs .source-ref'))).toEqual([
        ['1', true],
        ['2', false],
      ]);
    });

    it('leaves a quotation from a slide the reply lacks unmarked', () => {
      const view = show(
        {
          text: 'Drones are male.',
          quotes: [{ sourceId: id('s9'), quote: 'Drones are male.' }],
          sentences: [sentence('Drones are male.', [])],
          sources: [id('s9')],
        },
        { slides: [DERIVED_HIVE] },
      );
      expect(marked(view.querySelectorAll('q.explanation-quote'))).toEqual([
        ['Drones are male.', false],
      ]);
    });
  });

  it('shows no attributed note and no may-be-relevant label at the deep depth', () => {
    const view = show(GROUNDED.explanation, { depth: 'deep' });
    expect(screen.queryByText(ATTRIBUTED_NOTE)).toBeNull();
    expect(view.querySelector('.sentence-refs-label')).toBeNull();
    expect(view.querySelectorAll('.sentence-refs .source-ref')).toHaveLength(3);
  });
});
