import { expect, type Page } from '@playwright/test';

// Shared by the specs. The research key matches playwright.config.ts.
export const RESEARCH_KEY = 'e2e-research-key-0123456789';
export const researchHeaders = { Authorization: `Bearer ${RESEARCH_KEY}` };

export const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();

export async function setup(page: Page, query: string, id: string) {
  await page.goto(`/${query}`);
  await page.getByLabel('Anonymous participant ID').fill(id);
  await page.getByLabel('Year of study').selectOption('2nd year');
  await page.getByLabel('Programming experience').selectOption('1 to 2 years');
  await page.getByRole('group', { name: /confident are you writing Python/ }).getByLabel('3').check();
  await page.getByRole('group', { name: /AI tools/ }).getByLabel('Weekly').check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start' }).click();
}

export async function proficiency(page: Page) {
  await expect(page.getByRole('heading', { name: 'A few Python questions' })).toBeVisible();
  const groups = page.locator('fieldset.choice');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start the practice task' }).click();
}

export async function doTask(page: Page) {
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: '✓ Run tests' }).click();
  await expect(page.locator('.tab-body .badge').first()).not.toHaveText('not run');

  if (await page.getByRole('heading', { name: 'No AI for this task' }).isVisible()) {
    // type into the editor to make sure editing works
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n# checked');
    await page.getByRole('button', { name: '▶ Run code' }).click();
    await expect(page.locator('pre.console')).not.toHaveText('Running…');
  } else {
    const ask = page.getByRole('button', { name: 'Get AI suggestion' });
    await expect(ask).toBeDisabled();
    await expect(page.getByRole('heading', { name: '2. AI suggestion' })).toHaveCount(0);
    await page.getByLabel('What do you think is wrong?').fill('I think the loop or condition handles an edge case wrongly.');
    await page.getByLabel('Which line is most likely wrong?').selectOption({ index: 2 });
    await ask.click();
    await expect(page.getByRole('heading', { name: '2. AI suggestion' })).toBeVisible();

    const check = page.locator('.check-card');
    if (await check.isVisible()) {
      await expect(page.getByRole('button', { name: /Accept/ })).toBeDisabled();
      await check.getByRole('radio').first().check();
      await check.getByRole('button', { name: 'Submit answer' }).click();
      await expect(check.locator('.feedback')).toBeVisible();
    }
    await expect(page.locator('.diff')).toBeVisible();
    await page.getByRole('button', { name: /Accept/ }).click();
    await expect(page.getByRole('button', { name: /Accept/ })).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByRole('button', { name: 'Submit final code' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'visible tests' })).toBeVisible();
}

export async function likertAll(page: Page, value: string) {
  const groups = page.locator('fieldset.choice');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByLabel(value, { exact: true }).check();
}

export async function runStudy(page: Page) {
  for (let guard = 0; guard < 30; guard++) {
    const heading = (await page.locator('main h1').first().textContent()) ?? '';
    if (heading.startsWith('Thank you')) return;
    if (heading === 'About that task') {
      await likertAll(page, '4');
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (heading.startsWith('Questions about Part')) {
      const sliders = page.locator('input[type=range]');
      // 50 is where an untouched slider sits, so fill() wouldn't fire a change for it
      for (let i = 0; i < (await sliders.count()); i++) await sliders.nth(i).fill(String(15 + i * 10));
      await likertAll(page, '3');
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (heading === 'Last few questions') {
      await likertAll(page, 'Part 2');
      await page.getByRole('button', { name: 'Continue' }).click();
    } else {
      await doTask(page);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    // no two screens in a row share a heading, so wait for the next one
    await expect(page.locator('main h1').first()).not.toHaveText(heading);
  }
  throw new Error('study did not finish');
}
