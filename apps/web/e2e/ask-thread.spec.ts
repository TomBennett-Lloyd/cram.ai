import { expect, test } from '@playwright/test';
import { NEW_QUESTION, SEARCHED_FOR } from '../src/copy';
import {
  FOLLOW_UP_QUESTION,
  FOLLOW_UP_SEARCHED,
  GROUNDED_QUESTION,
  GROUNDED_TEXT,
  stubApi,
} from './hermetic-api';

/** `docs/adr/0011-ask-conversation.md` § Decision (f). */
test('a follow-up joins the thread under the first answer, carrying it, and New question starts afresh', async ({
  page,
}) => {
  await stubApi(page);
  const bodies: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/ask')) bodies.push(JSON.parse(request.postData() ?? '{}'));
  });
  await page.goto('/#/courses/bio');
  const answer = page.getByRole('region', { name: 'Answer' });
  const ask = async (question: string) => {
    await page.getByRole('textbox', { name: 'Question' }).fill(question);
    await page.getByRole('button', { name: 'Ask' }).click();
  };
  await ask(GROUNDED_QUESTION);
  await expect(answer.locator('.exchange .explanation-text')).toHaveCount(1);
  await ask(FOLLOW_UP_QUESTION);
  const exchanges = answer.locator('.exchange');
  await expect(exchanges).toHaveCount(2);
  await expect(exchanges.locator('.exchange-question')).toHaveText([
    GROUNDED_QUESTION,
    FOLLOW_UP_QUESTION,
  ]);
  await expect(exchanges.nth(1).locator('.searched')).toHaveText(
    `${SEARCHED_FOR} ${FOLLOW_UP_SEARCHED}`,
  );
  await expect(answer.locator('.sources-entry')).toHaveCount(4);
  expect(bodies).toEqual([
    { question: GROUNDED_QUESTION, turns: [] },
    {
      question: FOLLOW_UP_QUESTION,
      turns: [{ question: GROUNDED_QUESTION, answer: GROUNDED_TEXT }],
    },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: NEW_QUESTION }).click();
  await expect(exchanges).toHaveCount(0);
});
