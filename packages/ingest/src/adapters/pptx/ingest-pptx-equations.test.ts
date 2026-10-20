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

/** A math run as PowerPoint writes it, one character to a run, in Cambria Math. */
const mathRun = (text: string): string =>
  `<m:r><a:rPr><a:latin typeface="Cambria Math"/></a:rPr><m:t>${text}</m:t></m:r>`;

/**
 * `E=mc^2+â` in the characters PowerPoint 16.114 wrote in #159's probes. Assumption: PowerPoint writes math alphanumerics in `m:t`. Check it on a
 * self-authored deck: `unzip -p <deck>.pptx ppt/slides/slide1.xml | grep -o '<m:t>[^<]*</m:t>'`.
 */
const POWERPOINT_EQUATION = equation(
  `<m:oMath>${['𝐸', '=', '𝑚'].map(mathRun).join('')}<m:sSup><m:e>${mathRun('𝑐')}</m:e><m:sup>${mathRun('2')}</m:sup></m:sSup>${mathRun('+')}<m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e>${mathRun('𝑎')}</m:e></m:acc></m:oMath>`,
);

describe('ingestPptx equations (#126)', () => {
  it("reads PowerPoint's math italic as plain letters, from a shape whose fallback is an image (#159)", () => {
    const [record] = ingested({
      slides: [
        {
          shapes: [
            shape(['Rest energy'], 'title'),
            alternateContent(
              shape([paragraphOf(run('Rest energy is '), POWERPOINT_EQUATION)]),
              picture,
            ),
          ],
        },
      ],
    });
    expect(record?.body).toBe('Rest energy is E=mc^2+\u00E2');
  });

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
