import { expect, test, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();

async function setup(page: Page, query: string, id: string) {
  await page.goto(`/${query}`);
  await page.getByLabel('Anonymous participant ID').fill(id);
  await page.getByLabel('Year of study').selectOption('2nd year');
  await page.getByLabel('Programming experience').selectOption('1 to 2 years');
  await page.getByRole('group', { name: /confident are you writing Python/ }).getByLabel('3').check();
  await page.getByRole('group', { name: /AI tools/ }).getByLabel('Weekly').check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start' }).click();
}

async function proficiency(page: Page) {
  await expect(page.getByRole('heading', { name: 'A few Python questions' })).toBeVisible();
  const groups = page.locator('fieldset.choice');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start the practice task' }).click();
}

async function doTask(page: Page) {
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

async function likertAll(page: Page, value: string) {
  const groups = page.locator('fieldset.choice');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByLabel(value, { exact: true }).check();
}

async function runStudy(page: Page) {
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
