import { expect, type Page, test } from '@playwright/test';
import { GROUNDED_QUESTION, stubApi } from './hermetic-api';

const NARROWEST = { width: 320, height: 640 };

const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(NARROWEST);
  await stubApi(page);
});

for (const path of ['/', '/#/courses/bio/decks']) {
  test(`${path} never scrolls sideways at the narrowest phone width`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
}

test('an answer and its open slide fit the narrowest phone width', async ({ page }) => {
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('.unit')).toHaveCount(2);
  expect(await scrollsSideways(page)).toBe(false);
  await page.locator('.slide-card').first().click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= NARROWEST.width).toBe(true);
});
