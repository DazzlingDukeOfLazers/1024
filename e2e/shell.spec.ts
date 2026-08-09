import { type Page, expect, test } from '@playwright/test';

const readoutRow = (page: Page, header: string) =>
  page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: header, exact: true }) });

test('the app shell navigates between lenses', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Scale Atlas / Numerical Microscope' }),
  ).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Lenses' });
  await expect(nav.getByRole('button')).toHaveCount(5);

  await nav.getByRole('button', { name: 'Scale Atlas' }).click();
  await expect(page.getByText('What order of magnitude is this?')).toBeVisible();

  await nav.getByRole('button', { name: 'Representation Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Exact quantity core' })).toBeVisible();
});

test('0.1 m stays exactly one tenth however it is displayed', async ({ page }) => {
  await page.goto('/');

  await expect(readoutRow(page, 'Exact rational')).toContainText('1/10');
  await expect(readoutRow(page, 'Engineering')).toContainText('100 mm');
  await expect(readoutRow(page, 'Scientific')).toContainText('1 × 10^-1 m');
  await expect(readoutRow(page, 'In mm')).toContainText('100 mm');

  // Changing the display unit re-reads the value; it must not rewrite it.
  await page.getByLabel('Read as').selectOption('µm');
  await expect(readoutRow(page, 'In µm')).toContainText('100000 µm');
  await expect(readoutRow(page, 'Exact rational')).toContainText('1/10');
});

test('rounded renderings are labelled as rounded', async ({ page }) => {
  await page.goto('/');

  await expect(readoutRow(page, 'Engineering')).toContainText('exact');

  await page.getByLabel('Value').fill('0.123456789');
  await expect(readoutRow(page, 'Engineering')).toContainText('123.5 mm');
  await expect(readoutRow(page, 'Engineering')).toContainText('rounded');
  await expect(readoutRow(page, 'Exact rational')).toContainText('123456789/1000000000');
});

test('magnitudes far outside binary64 range still resolve', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Value').fill('1e400');
  await expect(readoutRow(page, 'Order of magnitude')).toContainText('10^400');
  await expect(readoutRow(page, 'log10 (atlas position)')).toContainText('400.000000');
});

test('the finite machines trade range against resolution', async ({ page }) => {
  await page.goto('/');

  const table = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Same 256 bits. Pick your ruler.' }) });

  await expect(table.getByRole('rowheader', { name: 'Q128.128 @ mm', exact: true })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Q128.128 @ km', exact: true })).toBeVisible();

  // 0.1 m is quantized on every binary grid.
  await expect(table.getByText('quantized').first()).toBeVisible();

  // 1 mm is exact at @mm and quantized at @m — same 256 bits, different ruler.
  await page.getByLabel('Value').fill('1');
  await page.getByLabel('Unit', { exact: true }).selectOption('mm');

  const atMm = table
    .locator('tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Q128.128 @ mm', exact: true }) });
  const atM = table
    .locator('tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Q128.128 @ m', exact: true }) });
  await expect(atMm).toContainText('exact');
  await expect(atM).toContainText('quantized');
});

test('the Planck grid states that it is a thought experiment', async ({ page }) => {
  await page.goto('/');

  const planck = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Planck grid (256-bit integer)' }) });

  await expect(planck).toContainText('not a claim that spacetime is discrete');
  await expect(planck).toContainText('CODATA 2018');
  await expect(planck.getByRole('rowheader', { name: 'This value' })).toBeVisible();
});
