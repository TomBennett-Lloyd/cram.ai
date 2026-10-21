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

/** Whether any element matched overflows its own box sideways. */
const overflows = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((nodes) => nodes.some((node) => node.scrollWidth > node.clientWidth));

test('a long file name wraps inside the decks list', async ({ page }) => {
  await page.goto('/#/courses/bio/decks');
  await expect(page.locator('.upload')).toHaveCount(1);
  expect(await overflows(page, '.upload')).toBe(false);
  expect(await scrollsSideways(page)).toBe(false);
});

test('a portrait slide picture letterboxes inside the 16:9 frame instead of growing it', async ({
  page,
}) => {
  await page.route('**/courses/*/slide-image?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="100%" height="100%" fill="white"/></svg>',
    }),
  );
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  await page.locator('.slide-card').first().click();
  const image = page.getByRole('dialog').getByRole('img');
  await expect(image).toHaveJSProperty('complete', true);
  const frame = await page.locator('.slide-figure').boundingBox();
  expect(frame).not.toBeNull();
  expect(Math.abs((frame?.height ?? 0) - ((frame?.width ?? 0) * 9) / 16)).toBeLessThan(2);
});

test('an answer and its open slide fit the narrowest phone width', async ({ page }) => {
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(page.locator('.unit')).toHaveCount(2);
  expect(await overflows(page, '.slide-card')).toBe(false);
  expect(await scrollsSideways(page)).toBe(false);
  await page.locator('.slide-card').first().click();
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= NARROWEST.width).toBe(true);
  const image = await dialog.getByRole('img').boundingBox();
  expect(image).not.toBeNull();
  expect((image?.x ?? -1) >= (box?.x ?? 0)).toBe(true);
  expect((image?.x ?? 0) + (image?.width ?? Infinity) <= (box?.x ?? 0) + (box?.width ?? 0)).toBe(
    true,
  );
  expect(await overflows(page, '.slide-lines li')).toBe(false);
});
