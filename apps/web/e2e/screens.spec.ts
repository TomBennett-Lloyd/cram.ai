import { expect, test } from '@playwright/test';
import { stubApi } from './hermetic-api';

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test('the course list links each course and a new name goes to its decks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'bio' })).toHaveAttribute('href', '#/courses/bio');
  await page.getByLabel('New course').fill('Cell Biology');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/#\/courses\/cell-biology\/decks$/);
});

test('the decks screen follows an upload until it is indexed', async ({ page }) => {
  await page.goto('/#/courses/bio/decks');
  await expect(page.getByText('Reading slides…')).toBeVisible();
  await expect(page.getByText('2 slides indexed.')).toBeVisible();
  const posted = page.waitForRequest((request) => request.method() === 'POST');
  await page.getByLabel('Add decks').setInputFiles({
    name: 'l2.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-synthetic'),
  });
  expect((await posted).url()).toContain('/courses/bio/decks?lectureId=l2&fileName=l2.pdf');
});
