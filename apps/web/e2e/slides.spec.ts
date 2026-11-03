import { expect, type Page, test } from '@playwright/test';
import { LONG_FILE_NAME, stubApi } from './hermetic-api';

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

const tagsOn = (page: Page, name: string) =>
  page.getByRole('list', { name: `Tags on ${name}` }).locator('.tag-text');

const written = (page: Page) =>
  page.waitForResponse((response) => response.request().method() === 'PUT');

test('a tag added and a tag removed in the slide browser are still so after a reload', async ({
  page,
}) => {
  await page.goto('/#/courses/bio/decks/l1');
  await expect(tagsOn(page, 'slide 4')).toHaveText(['castes', 'drones']);
  const field = page.getByRole('textbox', { name: 'Add a tag to slide 4' });
  await field.fill('royal jelly');
  const added = written(page);
  await field.press('Enter');
  await added;
  const removed = written(page);
  await page.getByRole('button', { name: 'Remove the suggested tag castes' }).click();
  await removed;
  await expect(tagsOn(page, 'slide 4')).toHaveText(['drones', 'royal jelly']);
  await page.reload();
  await expect(tagsOn(page, 'slide 4')).toHaveText(['drones', 'royal jelly']);
  await expect(page.locator('.tag[data-origin="student"]')).toHaveText(['royal jelly×']);
});

test('the decks list links an indexed lecture to its slide browser', async ({ page }) => {
  await page.goto('/#/courses/bio/decks');
  await page.getByRole('link', { name: LONG_FILE_NAME }).click();
  await expect(page).toHaveURL(/#\/courses\/bio\/decks\/l1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lecture 1: The Hive');
});
