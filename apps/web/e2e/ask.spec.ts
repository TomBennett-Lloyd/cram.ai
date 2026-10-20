import { expect, type Page, test } from '@playwright/test';
import { GROUNDED_QUESTION, NOT_COVERED_QUESTION, stubApi } from './hermetic-api';

test.beforeEach(async ({ page }) => {
  await stubApi(page);
  await page.goto('/#/courses/bio');
});

const ask = async (page: Page, question: string) => {
  await page.getByRole('textbox', { name: 'Question' }).fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
};

test('an answer shows each unit with a card per cited slide', async ({ page }) => {
  await ask(page, GROUNDED_QUESTION);
  const answer = page.getByRole('region', { name: 'Answer' });
  await expect(answer.locator('.unit-text')).toHaveText([
    'Drones are male.',
    'Workers are female, and comb cells are hexagonal.',
  ]);
  await expect(answer.locator('.unit').nth(1).locator('.slide-card')).toHaveCount(2);
});

test('a card opens its slide as a modal with the quote marked, and Escape returns to the card', async ({
  page,
}) => {
  await ask(page, GROUNDED_QUESTION);
  const card = page.locator('.unit').first().locator('.slide-card');
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
  await expect(dialog.locator('mark')).toHaveText(['Drones are male.']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('the close button returns focus to the card', async ({ page }) => {
  await ask(page, GROUNDED_QUESTION);
  const card = page.locator('.unit').nth(1).locator('.slide-card').nth(1);
  await card.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('what was withheld is folded until opened, with its reason', async ({ page }) => {
  await ask(page, GROUNDED_QUESTION);
  const panel = page.locator('details.withheld');
  await expect(panel.getByText('Queens rule the hive.')).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.getByText('Queens rule the hive.')).toBeVisible();
  await expect(panel.getByText('The cited slides don’t support it.')).toBeVisible();
});

test('a question the slides do not cover gets the fixed answer and the closest slides', async ({
  page,
}) => {
  await ask(page, NOT_COVERED_QUESTION);
  const answer = page.getByRole('region', { name: 'Answer' });
  await expect(answer.getByText('Your slides don’t cover this.')).toBeVisible();
  await expect(answer.locator('.slide-card')).toHaveText(['Lecture 1: The HiveSlide 7The comb']);
});
