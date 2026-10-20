import { expect, test } from '@playwright/test';
import { GROUNDED_QUESTION, stubApi } from './hermetic-api';

/**
 * Under `vite`, StrictMode runs the slide dialog's effect twice; its first cleanup once tried to
 * focus a card the open modal had made inert, and the re-run took the heading for its opener (#16).
 */
test('closing a slide returns focus to its card under StrictMode', async ({ page }) => {
  await stubApi(page);
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Ask' }).click();
  const card = page.locator('.slide-card').first();
  await card.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toBeFocused();
});
