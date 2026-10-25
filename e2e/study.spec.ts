import { expect, test } from '@playwright/test';
import { doTask, proficiency, runStudy, setup, uid } from './helpers';

test('a demo participant completes the full flow from setup to debrief', async ({ page }) => {
  await setup(page, '?demo=1&order=4', `E2E-${uid()}`);
  await proficiency(page);
  await expect(page.getByRole('heading', { name: 'Practice task' }).or(page.locator('.coach'))).toBeVisible();
  await runStudy(page);

  await expect(page.getByRole('heading', { name: "Thank you, you're done" })).toBeVisible();
  await expect(page.locator('table.debrief tbody tr')).toHaveCount(6);
  await expect(page.getByText('wrong or incomplete')).toHaveCount(3);
  await expect(page.getByText('All progress saved')).toBeVisible();
});

test('a study participant never sees the condition name, and a reload resumes the task', async ({ page }) => {
  await setup(page, '?order=2', `E2E-${uid()}`);
  await proficiency(page);
  await doTask(page); // practice
  await expect(page.getByText('Part 1 of 3 · Task 1 of 2')).toBeVisible();
  await page.getByLabel('What do you think is wrong?').fill('The boundary condition looks off by one.');
  await page.getByRole('button', { name: 'Get AI suggestion' }).click();
  await expect(page.getByRole('heading', { name: '2. AI suggestion' })).toBeVisible();

  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['direct ai', 'always verify', 'adaptive', 'support level', 'demo mode']) expect(text).not.toContain(word);

  await page.reload();
  await expect(page.getByRole('heading', { name: '2. AI suggestion' })).toBeVisible();
  await expect(page.locator('.own-diagnosis')).toContainText('boundary condition');
});

test('code that never ends is stopped and Python keeps working', async ({ page }) => {
  await setup(page, '?demo=1', `E2E-${uid()}`);
  await proficiency(page);
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nwhile True:\n    pass\n');
  await page.getByRole('button', { name: '▶ Run code' }).click();
  await expect(page.locator('pre.console')).toContainText('more than 5 seconds', { timeout: 20000 });

  await page.getByRole('button', { name: 'Reset code' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: '▶ Run code' }).click();
  await expect(page.locator('pre.console')).not.toContainText('more than 5 seconds', { timeout: 20000 });
  await expect(page.locator('pre.console')).not.toHaveText('Running…');
});
