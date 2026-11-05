import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COMB, CONTRADICTED, HIVE, retrievedSlide, sentence } from '../api/api-fixture';
import { APPEARS_TO_CONTRADICT, DERIVED_SOURCE } from '../copy';
import { id, refsIn, show } from './explanation-view-fixture';

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
        sentences: [sentence('Drones are male.', ['s1']), sentence('Cells are hexagonal.', ['s2'])],
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

  it('leaves a contradiction number naming a typed slide unmarked beside a derived one', () => {
    const view = show(CONTRADICTED, { slides: [HIVE, DERIVED_COMB] });
    expect(marked(view.querySelectorAll('.contradiction-refs .source-ref'))).toEqual([
      ['1', false],
    ]);
    expect(marked(view.querySelectorAll('.sentence-refs .source-ref'))).toEqual([
      ['1', false],
      ['2', true],
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
