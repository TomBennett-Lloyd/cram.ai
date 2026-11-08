import { expect, type Locator, test } from '@playwright/test';
import { SUPPLEMENTARY, SUPPLEMENTARY_NOTE } from '../src/copy';
import { stubApi, SUPPLEMENTARY_QUESTION, SUPPLEMENTARY_SENTENCE } from './hermetic-api';

const styleOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const own = getComputedStyle(node);
    return {
      line: own.textDecorationLine,
      size: own.fontSize,
      colour: own.color,
    };
  });

/** `docs/adr/0009-explanation-answers.md` § Decision (i): the supplementary label, in a real engine. */
test('a kept interpretation carries the supplementary label and note, and no underline', async ({
  page,
}) => {
  await stubApi(page);
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(SUPPLEMENTARY_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  const answer = page.getByRole('region', { name: 'Answer' });
  const label = answer.locator('.supplementary-label');
  await expect(label).toHaveText([SUPPLEMENTARY]);
  await expect(label).toBeVisible();
  expect((await label.boundingBox())?.height).toBeGreaterThan(0);
  const kept = answer.locator('.supplementary');
  await expect(kept).toHaveText([SUPPLEMENTARY_SENTENCE]);
  expect((await styleOf(kept)).line).toBe('none');
  const refsLabel = answer.locator('.sentence-refs-label').first();
  const { size, colour } = await styleOf(refsLabel);
  expect(await styleOf(label)).toMatchObject({ line: 'none', size, colour });
  expect((await styleOf(answer.locator('q.explanation-quote'))).line).toBe('underline');
  await expect(answer.getByText(SUPPLEMENTARY_NOTE)).toBeVisible();
});
