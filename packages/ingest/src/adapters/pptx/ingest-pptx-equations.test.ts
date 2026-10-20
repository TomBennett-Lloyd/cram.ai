import { describe, expect, it } from 'vitest';
import {
  alternateContent,
  equation,
  lineBreak,
  paragraphOf,
  picture,
  run,
  shape,
  ingestedSlides as ingested,
} from './deck-fixture';

describe('ingestPptx equations (#126)', () => {
  it('reads an equation where it stands in its sentence, once, from the choice', () => {
    const massEnergy = equation(
      '<m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>',
    );
    const sentence = (before: string, after: string): string =>
      paragraphOf(run(before), massEnergy, run(after));
    const [record] = ingested({
      slides: [
        {
          shapes: [
            alternateContent(
              shape([sentence('Why ', ' matters')], 'title'),
              shape(['Fallback title'], 'title'),
            ),
            alternateContent(
              shape([sentence('Rest energy is ', ' for a body of mass m')]),
              picture,
            ),
          ],
          notes: [sentence('Derive ', ' on the board.')],
        },
      ],
    });
    expect(record).toMatchObject({
      title: 'Why E=mc^2 matters',
      body: 'Rest energy is E=mc^2 for a body of mass m',
      speakerNotes: 'Derive E=mc^2 on the board.',
    });
  });

  it("reads only DrawingML's own text and breaks, and only a14's equations", () => {
    const other = (name: string, content = ''): string =>
      `<x:${name} xmlns:x="urn:example:other">${content}</x:${name}>`;
    const [record] = ingested({
      slides: [
        {
          shapes: [
            shape(['Rate laws'], 'title'),
            shape([
              paragraphOf(
                run('Rate'),
                other('br'),
                run('laws '),
                other('t', 'dropped'),
                other('m', `${run('of')}${lineBreak}${run('first order reactions')}`),
              ),
            ]),
          ],
        },
      ],
    });
    expect(record?.body).toBe('Ratelaws of first order reactions');
  });
});
