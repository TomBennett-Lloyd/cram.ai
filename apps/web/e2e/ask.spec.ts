import { expect, type Locator, type Page, test } from '@playwright/test';
import { APPEARS_TO_CONTRADICT, ATTRIBUTED_NOTE, SLIDE_CONTRADICTION } from '../src/copy';
import {
  COMB_TITLE,
  CONTRADICTED_QUESTION,
  CONTRADICTED_SENTENCE,
  GROUNDED_QUESTION,
  NOT_COVERED_QUESTION,
  stubApi,
} from './hermetic-api';

test.beforeEach(async ({ page }) => {
  await stubApi(page);
  await page.goto('/#/courses/bio');
});

const ask = async (page: Page, question: string) => {
  await page.getByRole('textbox', { name: 'Question' }).fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
};

const CONTRADICTION_BUTTON = `${APPEARS_TO_CONTRADICT} Lecture 1: The Hive, slide 4`;

/** The underline a mark paints, its weight, and whether that weight is heavier than its parent's. */
const treatment = (locator: Locator) =>
  locator.evaluate((node) => {
    const own = getComputedStyle(node);
    const parent = node.parentElement === null ? own : getComputedStyle(node.parentElement);
    return {
      line: own.textDecorationLine,
      style: own.textDecorationStyle,
      colour: own.textDecorationColor,
      heavier: Number(own.fontWeight) > Number(parent.fontWeight),
    };
  });

/** A token's colour as the engine resolves it, through a probe element. */
const tokenColour = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

test('an answer shows its prose with the quote marked, each sentence’s numbers, the note and the sources', async ({
  page,
}) => {
  await ask(page, GROUNDED_QUESTION);
  const answer = page.getByRole('region', { name: 'Answer' });
  await expect(answer.locator('.explanation-text')).toContainText(
    'Workers are female, and comb cells are hexagonal.',
  );
  await expect(answer.locator('q.explanation-quote')).toHaveText(['Drones are male.']);
  expect(await treatment(answer.locator('q.explanation-quote'))).toEqual({
    line: 'underline',
    style: 'solid',
    colour: await tokenColour(page, '--color-accent'),
    heavier: true,
  });
  await expect(answer.locator('.sentence-refs')).toHaveText([
    'may be relevant1',
    'may be relevant12',
  ]);
  await expect(answer.getByText(ATTRIBUTED_NOTE)).toBeVisible();
  await expect(answer.locator('.sources-entry')).toHaveText([
    '1Lecture 1: The HiveSlide 4Castes',
    `2Lecture 1: The HiveSlide 7${COMB_TITLE}`,
  ]);
  await expect(answer.locator('.contradicted')).toHaveCount(0);
});

test('a number takes focus to its sources entry, which opens its slide as a modal with the quote marked, and Escape returns to the entry', async ({
  page,
}) => {
  await ask(page, GROUNDED_QUESTION);
  await page.getByRole('button', { name: 'Source 2: Lecture 1: The Hive, slide 7' }).click();
  const comb = page.locator('.sources-entry').nth(1).locator('.slide-card');
  await expect(comb).toBeFocused();
  expect(await comb.evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight)).toBe(
    true,
  );
  const card = page.locator('.sources-entry').first().locator('.slide-card');
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
  await expect(dialog.locator('mark')).toHaveText(['Drones are male.']);
  await expect(dialog.locator('.slide-contradiction')).toHaveCount(0);
  await expect(
    dialog.getByRole('list', { name: 'Lines found on this slide' }).getByRole('listitem'),
  ).toHaveText(['Worker bees are female.', 'Drones are male.']);
  const image = dialog.getByRole('img');
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
  ).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Speaker notes' })).toBeVisible();
  await expect(dialog.getByText('Drones do not forage.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('the close button returns focus to the sources entry', async ({ page }) => {
  await ask(page, GROUNDED_QUESTION);
  const card = page.locator('.sources-entry').nth(1).locator('.slide-card');
  await card.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toBeFocused();
});

test('a contradicted sentence carries a wavy danger underline in regular weight, told from the quote', async ({
  page,
}) => {
  await ask(page, CONTRADICTED_QUESTION);
  const marked = page.locator('.contradicted');
  await expect(marked).toHaveText([CONTRADICTED_SENTENCE]);
  expect(await treatment(marked)).toEqual({
    line: 'underline',
    style: 'wavy',
    colour: await tokenColour(page, '--color-danger'),
    heavier: false,
  });
  expect(await marked.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('400');
  expect(await treatment(page.locator('q.explanation-quote'))).toMatchObject({ style: 'solid' });
  await expect(page.locator('.contradiction-label')).toBeHidden();
});

test('the contradiction label shows on hover over the sentence or its number, and hides when the pointer leaves', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'hover is a pointer arm; the phone project is touch');
  await ask(page, CONTRADICTED_QUESTION);
  const label = page.locator('.contradiction-label');
  const button = page.getByRole('button', { name: CONTRADICTION_BUTTON });
  await expect(label).toBeHidden();
  const atRest = await button.boundingBox();
  await page.locator('.contradicted').hover();
  await expect(label).toBeVisible();
  expect(await button.boundingBox()).toEqual(atRest);
  await button.hover();
  await expect(label).toBeVisible();
  await page.getByRole('textbox', { name: 'Question' }).hover();
  await expect(label).toBeHidden();
});

test('a mouse press on the contradiction number leaves no label once the pointer leaves', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'the mouse arm runs on the desktop project');
  await ask(page, CONTRADICTED_QUESTION);
  const button = page.getByRole('button', { name: CONTRADICTION_BUTTON });
  await button.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(button).toBeFocused();
  await page.getByRole('textbox', { name: 'Question' }).hover();
  await expect(page.locator('.contradiction-label')).toBeHidden();
});

test('the contradiction number opens the contradicting slide, naming the sentence', async ({
  page,
}) => {
  await ask(page, CONTRADICTED_QUESTION);
  const button = page.getByRole('button', { name: CONTRADICTION_BUTTON });
  await expect(button).toHaveText('1');
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Lecture 1: The Hive · slide 4' });
  await expect(dialog.locator('.slide-contradiction')).toHaveText(
    `${SLIDE_CONTRADICTION} ${CONTRADICTED_SENTENCE}`,
  );
  await expect(dialog.locator('.slide-contradiction .contradicted')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(button).toBeFocused();
});

test('what was withheld is folded until opened, with its reason', async ({ page }) => {
  await ask(page, GROUNDED_QUESTION);
  const panel = page.locator('details.withheld');
  await expect(panel.getByText('Queens rule the hive.')).toBeHidden();
  await panel.locator('summary').click();
  await expect(panel.getByText('Queens rule the hive.')).toBeVisible();
  await expect(panel.getByText('No slide this answer was written from says it.')).toBeVisible();
});

test('a question the slides do not cover gets the fixed answer and the closest slides', async ({
  page,
}) => {
  await ask(page, NOT_COVERED_QUESTION);
  const answer = page.getByRole('region', { name: 'Answer' });
  await expect(answer.getByText('Your slides don’t cover this.')).toBeVisible();
  await expect(answer.locator('.slide-card')).toHaveText([
    `Lecture 1: The HiveSlide 7${COMB_TITLE}`,
  ]);
});
