import { expect, test } from '@playwright/test';
import { stubApi, WITHHELD_SUMMARY_LINE } from './hermetic-api';

test.beforeEach(async ({ page }) => {
  await stubApi(page, { summaryWithheld: true });
});

test('a summary’s withheld lines are folded beside it, each with its reason and its slides laid out as a line’s are', async ({
  page,
}) => {
  await page.goto('/#/courses/bio/decks');
  const panel = page.locator('details.withheld');
  await expect(panel.locator('summary')).toHaveText('Withheld (1)');
  await expect(panel.getByText(WITHHELD_SUMMARY_LINE)).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.getByText(WITHHELD_SUMMARY_LINE)).toBeVisible();
  await expect(panel.getByText('The slides it cites don’t say it.')).toBeVisible();
  const sources = panel.locator('.citations');
  await expect(sources.locator('.slide-card')).toHaveCount(2);
  await expect(sources).toHaveCSS('flex-direction', 'row');
  await expect(sources).toHaveCSS('padding-top', '0px');
  await page.locator('details.lecture-summary summary').click();
  await expect(page.locator('.summary-lines')).not.toContainText(WITHHELD_SUMMARY_LINE);
});
