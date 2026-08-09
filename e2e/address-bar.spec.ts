import { expect, test } from '@playwright/test';

/**
 * The URL is displayed state. If the address bar says one view and the screen
 * shows another, the app is misreporting itself — which for this project is the
 * same class of fault as misreporting a number.
 */

const openLens = async (page: import('@playwright/test').Page, name: string) => {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
};

test('the view follows the address bar', async ({ page }) => {
  await page.goto('/');

  await openLens(page, 'Metric Ruler');
  await page.getByRole('button', { name: 'Share this view' }).click();
  const rulerUrl = page.url();
  expect(rulerUrl).toContain('#');

  await openLens(page, 'Scale Atlas');
  await page.getByRole('button', { name: 'Share this view' }).click();
  const atlasUrl = page.url();
  expect(atlasUrl).not.toBe(rulerUrl);

  // Same document, different fragment. Nothing reloads, so the app has to
  // notice on its own.
  await page.goto(rulerUrl);
  await expect(page.locator('svg.ruler')).toBeVisible();

  // And the browser's own back button has to work between two shared views.
  await page.goBack();
  await expect(page.locator('svg.atlas')).toBeVisible();

  await page.goForward();
  await expect(page.locator('svg.ruler')).toBeVisible();
});

test('a camera restored from the address bar is the one that was shared', async ({ page }) => {
  await page.goto('/');
  await openLens(page, 'Metric Ruler');
  await page.getByLabel('Preset').selectOption('far-origin');
  await page.getByRole('button', { name: 'Share this view' }).click();
  const farOrigin = page.url();

  await page.getByLabel('Preset').selectOption('human-scale');
  await expect(page.getByLabel('Preset')).toHaveValue('human-scale');

  // Back to the shared fragment, without a reload.
  await page.goto(farOrigin);
  await expect(page.getByLabel('Preset')).toHaveValue('far-origin');
  await expect(
    page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Centre', exact: true }) }),
  ).toContainText('100 Em');
});

test('the address bar stops describing a view once you leave it', async ({ page }) => {
  await page.goto('/');
  await openLens(page, 'Metric Ruler');
  await page.getByRole('button', { name: 'Share this view' }).click();
  expect(page.url()).toContain('#');
  await expect(page.getByText(/select to copy|copied/)).toBeVisible();

  // Move the view on. The fragment now describes something that is not on the
  // screen, and a reload would silently restore that instead of this — so it
  // goes, rather than sitting there looking current.
  await page.getByLabel('Preset').selectOption('human-scale');
  await expect.poll(() => page.url()).not.toContain('#');

  // The link is not lost, only relabelled: it is still in the field, and it is
  // still the view that was shared.
  await expect(page.getByLabel('Share URL')).toBeVisible();
  await expect(page.getByText('the view you shared, not the one on screen')).toBeVisible();
});

test('a fragment that cannot be read says so instead of half-loading', async ({ page }) => {
  await page.goto('/');
  await openLens(page, 'Metric Ruler');
  // Same document, so this is a fragment change rather than a reload.
  await page.goto(`${page.url()}#state=not-a-real-payload`);

  await expect(page.getByText(/Could not restore that link/)).toBeVisible();
  // The lens the user was looking at is still there; a bad link does not blank
  // the app or silently swap it for a default.
  await expect(page.locator('svg.ruler')).toBeVisible();
});
