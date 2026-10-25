import { expect, test } from '@playwright/test';
import { doTask, likertAll, proficiency, researchHeaders, setup, uid } from './helpers';

test('a reload keeps the draft code and half-filled survey answers', async ({ page }) => {
  await setup(page, '?demo=1&order=1', `E2E-${uid()}`);
  await proficiency(page);
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n# my draft note');
  await expect(page.getByText(/Draft saved in this browser at/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Draft restored from this browser')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('# my draft note');

  await doTask(page); // practice
  await doTask(page); // first experimental task
  await expect(page.getByRole('heading', { name: 'About that task' })).toBeVisible();
  const groups = page.locator('fieldset.choice');
  await groups.nth(0).getByLabel('5', { exact: true }).check();
  await groups.nth(1).getByLabel('2', { exact: true }).check();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'About that task' })).toBeVisible();
  await expect(groups.nth(0).getByLabel('5', { exact: true })).toBeChecked();
  await expect(groups.nth(1).getByLabel('2', { exact: true })).toBeChecked();
});

test('events queued while the server is unreachable are replayed with the step they happened on', async ({ page, request }) => {
  const id = `E2E-${uid()}`;
  await setup(page, '?demo=1&order=1', id); // order 1: Direct AI first
  await proficiency(page);
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });

  // The whole browser goes offline: the banner says so and work continues locally.
  await page.context().setOffline(true);
  await expect(page.getByText('This computer is offline.')).toBeVisible();
  await expect(page.getByText('Offline, will retry')).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText('All progress saved')).toBeVisible({ timeout: 20000 });

  // Only event delivery fails, so the participant can move on while events pile up.
  await page.route('**/api/sessions/*/events', (r) => r.abort());
  await doTask(page); // practice
  await expect(page.getByText("Can't reach the study server.")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/activity records are waiting to be sent/)).toBeVisible();
  await doTask(page); // first experimental task, in Part 1 (Direct AI)
  await expect(page.getByRole('heading', { name: 'About that task' })).toBeVisible();

  await page.unroute('**/api/sessions/*/events');
  await page.getByRole('button', { name: 'Try again now' }).click();
  await expect(page.getByText('All progress saved')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.offline-banner')).toHaveCount(0);

  const events = (await (await request.get('/api/export/events.json?demo=1', { headers: researchHeaders })).json()).filter((e: any) => e.participantId === id);
  const runs = events.filter((e: any) => e.type === 'tests_run');
  const practice = runs.find((e: any) => e.stepIndex === 2);
  const task = runs.find((e: any) => e.stepIndex === 3);
  expect(practice).toMatchObject({ role: 'practice', condition: null, attribution: 'client' });
  expect(task).toMatchObject({ role: 'experimental', condition: 'direct', block: 0, indexInBlock: 0, attribution: 'client' });
  // they arrived after the participant had moved on
  expect(task.receivedAtStepIndex).toBe(4);
  expect(events.every((e: any) => e.attribution === 'client')).toBe(true);
});

test('Python that fails to load can be retried without losing the code', async ({ page }) => {
  // The first Python worker points at a script that doesn't exist, as if the download had failed.
  await page.addInitScript(() => {
    const Real = window.Worker;
    let failed = false;
    window.Worker = class extends Real {
      constructor(url: string | URL, opts?: WorkerOptions) {
        if (!failed && String(url).includes('py-worker')) {
          failed = true;
          super('/does-not-exist-worker.mjs', opts);
        } else super(url, opts);
      }
    };
  });
  await setup(page, '?demo=1', `E2E-${uid()}`);
  await proficiency(page);
  await expect(page.getByText('Python unavailable')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Python stopped working' })).toBeVisible();

  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nprint("still here")');
  await page.getByRole('button', { name: '▶ Run code' }).click();
  await expect(page.locator('pre.console')).toContainText("Python isn't available");

  await page.getByRole('button', { name: 'Retry Python' }).first().click();
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Retry Python' })).toHaveCount(0);
  await page.getByRole('button', { name: '▶ Run code' }).click();
  await expect(page.locator('pre.console')).toContainText('still here', { timeout: 20000 });
});

test('screens take focus, the output tabs and editor work from the keyboard, and incomplete surveys point at the gap', async ({ page }) => {
  await setup(page, '?demo=1&order=1', `E2E-${uid()}`);
  await expect(page.getByRole('heading', { name: 'A few Python questions' })).toBeVisible();
  const groups = page.locator('fieldset.choice');
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('main h1')).toBeFocused();
  await expect(page).toHaveTitle(/How it works · CALIBRA CODE/);
  await page.getByRole('button', { name: 'Start the practice task' }).click();
  await expect(page.locator('main h1')).toBeFocused();
  await expect(page.locator('main h1')).not.toHaveText('How the tasks work');
  await expect(page.getByText('Python ready')).toBeVisible({ timeout: 90000 });

  // Tabs: arrow keys move between them.
  await page.getByRole('tab', { name: 'Visible tests' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Console' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Visible tests' })).toHaveAttribute('aria-selected', 'true');

  // Editor shortcuts.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nprint("shortcut")');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('pre.console')).toContainText('shortcut', { timeout: 20000 });
  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.getByRole('tab', { name: 'Visible tests' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tab-body .badge').first()).not.toHaveText('not run');

  await doTask(page); // practice
  await doTask(page);
  await expect(page.getByRole('heading', { name: 'About that task' })).toBeVisible();
  await expect(page.locator('main h1')).toBeFocused();
  await page.locator('fieldset.choice').nth(0).getByLabel('4', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('Please answer every question (3 left)');
  await expect(page.locator('fieldset.choice').nth(1).getByRole('radio').first()).toBeFocused();
  await likertAll(page, '4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'About that task' })).toHaveCount(0);
});

test('the researcher dashboard shows progress and records a technical issue', async ({ page }) => {
  const id = `E2E-${uid()}`;
  await setup(page, '?demo=1&order=1', id);
  await proficiency(page);
  await expect(page.locator('.coach')).toBeVisible();

  await page.goto('/researcher');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('alert')).toContainText('Research key required');
  await page.getByLabel(/Research key/).fill('e2e-research-key-0123456789');
  await page.getByRole('button', { name: 'Load' }).click();
  await page.getByLabel('Include demo sessions').check();

  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(id) }) });
  await expect(row).toContainText('practice task');
  await expect(row).toContainText('just now');
  await expect(page.getByRole('heading', { name: 'Task-pair balance' })).toBeVisible();
  await expect(page.getByText(/This server runs study version/)).toBeVisible();

  await row.getByRole('button', { name: 'Record issue' }).click();
  await page.getByLabel('What happened?').fill('Laptop froze, participant restarted the browser');
  await page.getByRole('button', { name: 'Save issue' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'excluded from the analysis' })).toBeVisible();
  const issues = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Technical issues' }) });
  await expect(issues.getByRole('row').filter({ hasText: id })).toContainText('excluded');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download everything (JSON)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^calibra-export-.*\.json$/);
});
