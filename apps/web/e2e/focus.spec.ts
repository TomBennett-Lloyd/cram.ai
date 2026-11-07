import { setTimeout as delay } from 'node:timers/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { APPEARS_TO_CONTRADICT, NEW_QUESTION, PENDING } from '../src/copy';
import { CONTRADICTED_QUESTION, GROUNDED_QUESTION, stubApi } from './hermetic-api';

/** Whether the element paints a focus ring now: an outline style other than `none`. */
const ringed = (locator: Locator) =>
  locator.evaluate((node) => getComputedStyle(node).outlineStyle !== 'none');

/** How long a released reply stays in transit: longer than a `focus()` and a Tab (#247). */
const IN_TRANSIT_MS = 500;

/**
 * The first sources entry of a rendered answer (#231). It waits for the entry because a Tab pressed
 * while the reply is pending leaves the document, and focus never returns when the answer lands
 * (#228).
 */
const answered = async (page: Page, question = GROUNDED_QUESTION) => {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const askReplyAfter = released.then(() => delay(IN_TRANSIT_MS));
  await stubApi(page, { askReplyAfter });
  await page.goto('/#/courses/bio');
  await page.getByRole('textbox', { name: 'Question' }).fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
  const reply = page.getByRole('region', { name: 'Answer' });
  await expect(reply.locator('[aria-busy="true"]')).toHaveText(PENDING.answer);
  release();
  const card = reply.locator('.sources-entry .slide-card').first();
  await expect(card).toBeVisible();
  return card;
};

test('a keyboard reader sees the ring on a source number', async ({ page }) => {
  await answered(page);
  await page.getByRole('button', { name: NEW_QUESTION }).focus();
  await page.keyboard.press('Tab');
  const number = page.locator('.source-ref').first();
  await expect(number).toBeFocused();
  expect(await ringed(number)).toBe(true);
});

test('a keyboard reader who reaches the contradiction button sees its ring and the label, gone once focus moves on', async ({
  page,
}) => {
  await answered(page, CONTRADICTED_QUESTION);
  const button = page.getByRole('button', {
    name: `Source 1: ${APPEARS_TO_CONTRADICT} Lecture 1: The Hive, slide 4`,
  });
  const label = page.locator('.contradiction-label');
  await expect(label).toBeHidden();
  await page.getByRole('button', { name: NEW_QUESTION }).focus();
  for (
    let presses = 0;
    presses < 5 && !(await button.evaluate((node) => node === document.activeElement));
    presses++
  )
    await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  expect(await ringed(button)).toBe(true);
  await expect(label).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(label).toBeHidden();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' })).toBeVisible();
});

test('a mouse press paints no ring on the dialog it opens, or on the card after it', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  const card = await answered(page);
  await card.click();
  const heading = page.getByRole('dialog').getByRole('heading', { level: 2 });
  await expect(heading).toBeFocused();
  expect(await ringed(heading)).toBe(false);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeFocused();
  expect(await ringed(card)).toBe(false);
});

test('a tap paints no ring on the dialog it opens, or on the card after it', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  const card = await answered(page);
  await card.tap();
  const heading = page.getByRole('dialog').getByRole('heading', { level: 2 });
  await expect(heading).toBeFocused();
  expect(await ringed(heading)).toBe(false);
  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(card).toBeFocused();
  expect(await ringed(card)).toBe(false);
});

const COMB_NUMBER = 'Source 2: Lecture 1: The Hive, slide 7';
const COMB_ENTRY = /Slide 7/;

test('a keyboard reader who presses Enter on a number lands on its sources entry, ringed', async ({
  page,
}) => {
  await answered(page);
  const number = page.getByRole('button', { name: COMB_NUMBER });
  await page.getByRole('button', { name: NEW_QUESTION }).focus();
  for (let presses = 0; presses < 6; presses++) {
    if (await number.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  const entry = page.getByRole('button', { name: COMB_ENTRY });
  await expect(entry).toBeFocused();
  expect(await ringed(entry)).toBe(true);
});

test('a mouse press on a number lands on its sources entry with no ring', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  await answered(page);
  await page.getByRole('button', { name: COMB_NUMBER }).click();
  const entry = page.getByRole('button', { name: COMB_ENTRY });
  await expect(entry).toBeFocused();
  expect(await ringed(entry)).toBe(false);
});

test('a tap on a number lands on its sources entry with no ring', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  await answered(page);
  await page.getByRole('button', { name: COMB_NUMBER }).tap();
  const entry = page.getByRole('button', { name: COMB_ENTRY });
  await expect(entry).toBeFocused();
  expect(await ringed(entry)).toBe(false);
});

test('a tap on the contradiction number, then on Close, leaves no ring and no label', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  await answered(page, CONTRADICTED_QUESTION);
  const button = page.getByRole('button', {
    name: `Source 1: ${APPEARS_TO_CONTRADICT} Lecture 1: The Hive, slide 4`,
  });
  await button.tap();
  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(button).toBeFocused();
  expect(await ringed(button)).toBe(false);
  await expect(page.locator('.contradiction-label')).toBeHidden();
});

/** The slide browser, the first tag's remove button, and the one that takes its place. */
const tagged = async (page: Page) => {
  await stubApi(page);
  await page.goto('/#/courses/bio/decks/l1');
  const remove = page.getByRole('button', { name: 'Remove the suggested tag castes' });
  await expect(remove).toBeVisible();
  return { remove, next: page.getByRole('button', { name: 'Remove the suggested tag drones' }) };
};

test('a keyboard reader who removes a tag lands on the next tag’s button, ringed', async ({
  page,
}) => {
  const { remove, next } = await tagged(page);
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(next).toBeFocused();
  expect(await ringed(next)).toBe(true);
});

test('a mouse press on a tag’s remove button paints no ring where the focus lands', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  const { remove, next } = await tagged(page);
  await remove.click();
  await expect(remove).toBeHidden();
  await expect(next).toBeFocused();
  expect(await ringed(next)).toBe(false);
});

test('a tap on a tag’s remove button paints no ring where the focus lands', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  const { remove, next } = await tagged(page);
  await remove.tap();
  await expect(remove).toBeHidden();
  await expect(next).toBeFocused();
  expect(await ringed(next)).toBe(false);
});

/** The decks screen with a rebuild report showing, and the picker its dismissal lands on. */
const reported = async (page: Page) => {
  await stubApi(page, { rebuildReport: true });
  await page.goto('/#/courses/bio/decks');
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  await expect(dismiss).toBeVisible();
  return { dismiss, picker: page.getByLabel('Add decks') };
};

test('a keyboard reader who dismisses the rebuild notice lands on the deck picker, ringed', async ({
  page,
}) => {
  const { dismiss, picker } = await reported(page);
  await dismiss.focus();
  await page.keyboard.press('Enter');
  await expect(picker).toBeFocused();
  expect(await ringed(picker)).toBe(true);
});

test('a mouse press on Dismiss paints no ring on the deck picker it lands on', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  const { dismiss, picker } = await reported(page);
  await dismiss.click();
  await expect(picker).toBeFocused();
  expect(await ringed(picker)).toBe(false);
});

test('a tap on Dismiss paints no ring on the deck picker it lands on', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the touch arm runs on the phone project');
  const { dismiss, picker } = await reported(page);
  await dismiss.tap();
  await expect(picker).toBeFocused();
  expect(await ringed(picker)).toBe(false);
});
