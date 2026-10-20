import { expect, type Locator, type Page, test } from '@playwright/test';
import { GROUNDED_QUESTION, stubApi } from './hermetic-api';

/** Whether the element paints a focus ring now: an outline style other than `none`. */
const ringed = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).outlineStyle !== 'none');

const answered = async (page: Page) => {
  await stubApi(page);
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  return page.locator('.slide-card').first();
};

test('a keyboard reader sees the ring on a slide card', async ({ page }) => {
  const card = await answered(page);
  await page.getByRole('button', { name: 'Ask' }).focus();
  await page.keyboard.press('Tab');
  await expect(card).toBeFocused();
  expect(await ringed(card)).toBe(true);
});

test('a mouse press paints no ring on the card, before or after its dialog', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  const card = await answered(page);
  await card.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await ringed(page.getByRole('button', { name: 'Close' }))).toBe(false);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeFocused();
  expect(await ringed(card)).toBe(false);
});

test('a tap paints no ring on the card', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  const card = await answered(page);
  await card.tap();
  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(card).toBeFocused();
  expect(await ringed(card)).toBe(false);
});
