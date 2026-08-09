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

const openRuler = async (page: Page) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();
};

test('the ruler grid re-steps through the engineering prefixes as it zooms', async ({ page }) => {
  await openRuler(page);

  const grid = readoutRow(page, 'Grid step');
  const scale = readoutRow(page, 'Scale');

  // The red blood cell preset frames a millimetre, so the grid is in µm.
  await expect(grid).toContainText('labelled in µm');

  const ruler = page.locator('svg.ruler');
  const box = await ruler.boundingBox();
  if (box === null) throw new Error('ruler has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Each wheel notch is 0.2 decades, so fifteen of them is exactly one SI
  // prefix step. The grid should re-step once per band, in order.
  const zoomOutOneBand = async () => {
    for (let i = 0; i < 15; i += 1) await page.mouse.wheel(0, 100);
  };

  await zoomOutOneBand();
  await expect(grid).toContainText('labelled in mm');
  await zoomOutOneBand();
  await expect(grid).toContainText('labelled in m');
  await zoomOutOneBand();
  await expect(grid).toContainText('labelled in km');

  await expect(scale).toContainText('per pixel');
});

test('the ruler resolves a millimetre beside a 1e20 m origin', async ({ page }) => {
  await openRuler(page);
  await page.getByLabel('Preset').selectOption('far-origin');

  // The camera centre really is out at 1e20 m...
  await expect(readoutRow(page, 'Centre')).toContainText('100 Em');
  // ...and the view across it is only centimetres wide.
  await expect(readoutRow(page, 'Across the view')).toContainText('9.6 mm');
  await expect(readoutRow(page, 'Grid step')).toContainText('labelled in mm');

  // The grid still has labelled ticks out there, which is the whole point:
  // every one is an exact multiple, positioned after an exact subtraction.
  const ticks = page.locator('svg.ruler g.ruler-grid text');
  expect(await ticks.count()).toBeGreaterThan(3);
});

test('the red blood cell row collapses to a strip as it zooms out', async ({ page }) => {
  await openRuler(page);

  const detail = readoutRow(page, 'Level of detail');

  // Framing a whole millimetre puts a cell at under six pixels: too small to
  // draw properly, big enough to draw individually.
  await expect(detail).toContainText('glyph');
  await expect(detail).toContainText('the count is the same at every level of detail');
  await expect(page.locator('svg.ruler ellipse')).toHaveCount(0);

  const ruler = page.locator('svg.ruler');
  const box = await ruler.boundingBox();
  if (box === null) throw new Error('ruler has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Zoom in and the cells become worth drawing as shapes.
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -100);
  await expect(detail).toContainText('detailed');
  await expect(page.locator('svg.ruler ellipse').first()).toBeVisible();

  // Zoom back out past a pixel and they become a density strip — while the
  // count of how many would span the view keeps rising.
  for (let i = 0; i < 15; i += 1) await page.mouse.wheel(0, 100);
  await expect(detail).toContainText('aggregate');
  await expect(page.locator('svg.ruler')).toContainText('drawn as density');
  await expect(page.locator('svg.ruler ellipse')).toHaveCount(0);
});

test('panning the ruler out and back returns exactly where it started', async ({ page }) => {
  await openRuler(page);
  await page.getByLabel('Preset').selectOption('human-scale');

  const centre = readoutRow(page, 'Centre');
  const before = await centre.textContent();

  const ruler = page.locator('svg.ruler');
  const box = await ruler.boundingBox();
  if (box === null) throw new Error('ruler has no box');
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, y, { steps: 12 });
  await page.mouse.move(box.x + 200, y, { steps: 12 });
  await page.mouse.up();

  // An exact rational centre does not accumulate drift over a drag.
  await expect(centre).toHaveText(before ?? '');
});

test('how many red blood cells span a millimetre', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();

  // The default comparison is exactly the one docs/IMPLEMENTATION_PLAN.md names.
  const answer = page.locator('p.answer');
  await expect(answer).toContainText('about 133');
  await expect(answer).toContainText('approximate');

  const row = (name: string) =>
    page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  // The arithmetic is exact; the cell is not, and the UI says which.
  await expect(row('Why approximate')).toContainText('The arithmetic is exact');
  await expect(row('Why approximate')).toContainText('Red blood cell (diameter)');
  await expect(row('Range')).toContainText('to');
  await expect(row('Red blood cell (diameter)')).toContainText('7.5 µm');
});

test('a comparison between two definitions is exact', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();

  await page.getByLabel('A', { exact: true }).selectOption('unit:µm');

  const answer = page.locator('p.answer');
  await expect(answer).toContainText('1000');
  await expect(answer).toContainText('exact');
  await expect(answer).not.toContainText('about');

  await expect(
    page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Why approximate' }) }),
  ).toContainText('Both inputs are exactly defined');
});

test('123 coconuts end to end', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();

  await page.getByLabel('A', { exact: true }).selectOption('object:coconut');
  await page.getByLabel('Operation').selectOption('end-to-end');
  await page.getByLabel('N', { exact: true }).fill('123');

  const answer = page.locator('p.answer');
  await expect(answer).toContainText('24.6 m');
  await expect(answer).toContainText('approximate');

  // Coconuts vary, so the answer has to as well.
  await expect(
    page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Range' }) }),
  ).toContainText('18.45 m to 36.9 m');
});

test('the comparison strip collapses when items fall below a pixel', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();

  const strip = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'To scale' }) });
  await expect(strip.locator('svg')).toBeVisible();

  // A red blood cell against a millimetre is 133 items — drawn individually.
  await expect(strip).toContainText('Drawn to scale');

  // A red blood cell against a light-year is not.
  await page.getByLabel('B', { exact: true }).selectOption('unit:ly');
  await expect(strip).toContainText('below a pixel');
  await expect(strip).toContainText('The count is unchanged');
});

test('the runner shows the representations disagreeing', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Representation drift' }) });
  const row = (name: string) =>
    panel.locator('tr').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  // 0.1 + 0.2 is the default experiment.
  await expect(row('Exact reference')).toContainText('3 × 10^-1 m');
  await expect(row('binary64')).toContainText('operations');
  await expect(row('Q128.128 @ m')).toContainText('operations');

  // The exact reference is truth, not a machine with error.
  await expect(row('Exact reference')).toContainText('truth');

  await page.getByLabel('Experiment').selectOption({ label: 'Large offset eats the millimeter' });
  await expect(row('Exact reference')).toContainText('1 × 10^-3 m');
  // binary64 loses the millimetre entirely; fixed point does not.
  await expect(row('binary64')).toContainText('0 m');
});

test('the floating-origin demonstration recovers the millimetre', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Floating origin rescues the millimetre' }) });

  await expect(
    panel
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Absolute coordinates' }) }),
  ).toContainText('lost entirely');
  await expect(
    panel
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Origin subtracted first' }) }),
  ).toContainText('1 × 10^-3 m');
});

test('binary64 shows the exact value it actually stored for 0.1', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'binary64', exact: true }) });

  // The whole point of the milestone: what the machine holds is not 0.1.
  await expect(
    panel
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Stored value (exact)' }) }),
  ).toContainText('0.1000000000000000055511151231257827021181583404541015625');

  // Two gaps, and at 0.1 they are equal because 0.1 is not near a power of two.
  await expect(panel.getByRole('rowheader', { name: 'Gap below' })).toBeVisible();
  await expect(panel.getByRole('rowheader', { name: 'Gap above' })).toBeVisible();
});

test('binary64 gaps are asymmetric at a power of two', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'binary64', exact: true }) });
  const row = (name: string) =>
    panel.locator('tr').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  await page.getByLabel('Value').fill('1');

  // 2^-53 below, 2^-52 above — the reason a single ULP figure is refused.
  await expect(row('Gap below')).toContainText('1.11 × 10^-16');
  await expect(row('Gap above')).toContainText('2.22 × 10^-16');
  await expect(row('Error vs intent')).toContainText('exact');
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
