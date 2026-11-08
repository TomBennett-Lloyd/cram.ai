import type { SentenceStanding } from '@cram/shared';
import { describe, expect, it } from 'vitest';
import { sentence } from '../api/api-fixture';
import { SUPPLEMENTARY, SUPPLEMENTARY_NOTE } from '../copy';
import { id, show } from './explanation-view-fixture';

const KEPT = 'In other words, the colony keeps drones only to mate.';

const explained = (standing: SentenceStanding, contradicts: readonly string[] = []) => ({
  text: `Drones are male. ${KEPT}`,
  quotes: [],
  sentences: [
    sentence('Drones are male.', ['s1'], 'entailed'),
    { ...sentence(KEPT, [], standing), contradicts: contradicts.map(id) },
  ],
  sources: [id('s1')],
});

/** `docs/adr/0009-explanation-answers.md` § Decision (i), the supplementary label. */
describe('a kept interpretation', () => {
  it('is wrapped and followed by the supplementary label', () => {
    const view = show(explained('interpretation'), { depth: 'deep' });
    expect([...view.querySelectorAll('.supplementary')].map((node) => node.textContent)).toEqual([
      KEPT,
    ]);
    const labels = [...view.querySelectorAll('.supplementary-label')];
    expect(labels.map((node) => node.textContent)).toEqual([SUPPLEMENTARY]);
    expect(labels[0]?.previousSibling?.previousSibling).toBe(view.querySelector('.supplementary'));
  });

  it('is not labelled when a slide entailed it', () => {
    const view = show(explained('entailed'), { depth: 'deep' });
    expect(view.querySelector('.supplementary')).toBeNull();
    expect(view.querySelector('.supplementary-label')).toBeNull();
    expect(view.textContent).not.toContain(SUPPLEMENTARY_NOTE);
  });

  it.each(['deep', 'light'] as const)(
    'brings the note at the %s depth, the field and not the depth deciding',
    (depth) => {
      const view = show(explained('interpretation'), { depth });
      expect(view.querySelector('.supplementary-note')?.textContent).toBe(SUPPLEMENTARY_NOTE);
    },
  );

  it('keeps the contradiction mark, and only it, on a contradicted sentence', () => {
    const view = show(explained('attributed', ['s1']));
    expect(view.querySelector('.contradicted')?.textContent).toBe(KEPT);
    expect(view.querySelector('.supplementary-label')).toBeNull();
  });
});
