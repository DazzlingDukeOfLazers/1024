import { type Page, expect, test } from '@playwright/test';
import { metresIn } from './parse';

const readoutRow = (page: Page, header: string) =>
  page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: header, exact: true }) });

/**
 * How wide the ruler is actually drawn. The view measures itself, so the span
 * it reports is its scale times this — a fixed figure like "9.6 mm across" is
 * only true at one width and is not what these tests should be pinning.
 */
const rulerWidth = async (page: Page): Promise<number> => {
  const box = await page.locator('svg.ruler').boundingBox();
  if (box === null) throw new Error('ruler has no box');
  return box.width;
};

/** The app lands on the Atlas, so lab tests navigate there first. */
const openLab = async (page: Page) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Representation Lab' })
    .click();
};

test('the app shell navigates between lenses', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Scale Atlas / Numerical Microscope' }),
  ).toBeVisible();

  // Five from docs/UI_SPEC.md, plus the architecture track from
  // docs/WIDE_INTEGER_ARCHITECTURE.md, which is an experiment rather than one of
  // the five and is listed last for that reason.
  const nav = page.getByRole('navigation', { name: 'Lenses' });
  await expect(nav.getByRole('button')).toHaveCount(6);
  await expect(nav.getByRole('button').last()).toHaveText('Architecture Lab');

  await nav.getByRole('button', { name: 'Scale Atlas' }).click();
  await expect(page.getByText('What order of magnitude is this?')).toBeVisible();

  await nav.getByRole('button', { name: 'Representation Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Exact quantity core' })).toBeVisible();
});

test('0.1 m stays exactly one tenth however it is displayed', async ({ page }) => {
  await openLab(page);

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
  await openLab(page);

  await expect(readoutRow(page, 'Engineering')).toContainText('exact');

  await page.getByLabel('Value').fill('0.123456789');
  await expect(readoutRow(page, 'Engineering')).toContainText('123.5 mm');
  await expect(readoutRow(page, 'Engineering')).toContainText('rounded');
  await expect(readoutRow(page, 'Exact rational')).toContainText('123456789/1000000000');
});

test('magnitudes far outside binary64 range still resolve', async ({ page }) => {
  await openLab(page);

  await page.getByLabel('Value').fill('1e400');
  await expect(readoutRow(page, 'Order of magnitude')).toContainText('10^400');
  await expect(readoutRow(page, 'log10 (atlas position)')).toContainText('400.000000');
});

test('the finite machines trade range against resolution', async ({ page }) => {
  await openLab(page);

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

const openMicroscope = async (page: Page) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Numerical Microscope' })
    .click();
};

test('the microscope shows what each representation can see here', async ({ page }) => {
  await openMicroscope(page);

  // One metre: binary64 sits on a power-of-two boundary, so its two neighbours
  // are different distances away.
  const binary64 = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'binary64', exact: true }) });
  await expect(binary64.getByText('asymmetric')).toBeVisible();
  await expect(binary64).toContainText('power-of-two boundary');
  await expect(
    binary64.locator('tr').filter({ has: page.getByRole('rowheader', { name: 'Gap below' }) }),
  ).toContainText('1.11 × 10^-16 m');
  await expect(
    binary64.locator('tr').filter({ has: page.getByRole('rowheader', { name: 'Gap above' }) }),
  ).toContainText('2.22 × 10^-16 m');

  // The fixed-point machine has one spacing, both ways.
  const q128 = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Q128.128 @ m', exact: true }) });
  await expect(q128).toContainText('Constant spacing everywhere in range');
  await expect(q128.getByText('asymmetric')).toHaveCount(0);
  await expect(q128.locator('svg')).toBeVisible();
});

test('binary64 spacing grows with magnitude while fixed point does not', async ({ page }) => {
  await openMicroscope(page);

  const gapAbove = (heading: string) =>
    page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Gap above' }) });

  // The acceptance criterion, read straight off the screen.
  await expect(gapAbove('binary64')).toContainText('2.22 × 10^-16 m');
  await expect(gapAbove('Q128.128 @ m')).toContainText('2.939 × 10^-39 m');

  // `exact` because the lattice SVGs are labelled "... representable values",
  // which getByLabel would otherwise match as a substring.
  await page.getByLabel('Value', { exact: true }).fill('1');
  await page.getByLabel('Unit', { exact: true }).selectOption('Gm');

  // binary64's spacing climbed sixteen decades; the fixed-point grid did not
  // move at all. 1 Gm sits in [2^29, 2^30), so the local gap is 2^-23 m.
  await expect(gapAbove('binary64')).toContainText('1.192 × 10^-7 m');
  await expect(gapAbove('Q128.128 @ m')).toContainText('2.939 × 10^-39 m');
});

test('the five values CLAUDE.md names are compared on one screen', async ({ page }) => {
  await openMicroscope(page);
  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Which of these can it hold exactly?' }) });

  // At @m, only the powers of two land.
  await expect(panel.locator('tbody tr')).toHaveCount(5);
  const row = (label: string) =>
    panel.locator('tr').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
  await expect(row('1 m')).toContainText('exact');
  await expect(row('1/2 m')).toContainText('exact');
  await expect(row('1 mm')).toContainText('quantized');
  await expect(row('1 cm')).toContainText('quantized');
  await expect(row('0.1 m')).toContainText('quantized');

  // Move the machine's base unit and all five become whole machine units.
  await page.getByLabel('Q128.128 base unit').selectOption('mm');
  for (const label of ['1 m', '1/2 m', '1 mm', '1 cm', '0.1 m']) {
    await expect(row(label), label).toContainText('exact');
  }
});

test('the four magnitudes CLAUDE.md names show the gap growing', async ({ page }) => {
  await openMicroscope(page);
  // Matched on a fragment: the heading renders a typographic apostrophe, and a
  // straight one in the test matches nothing at all.
  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: /How far apart are binary64/ }) });

  const row = (label: string) =>
    panel.locator('tr').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });

  // Zero to 1e20 m is twenty decades of magnitude and rather more of coarseness.
  await expect(row('0')).toContainText('4.941 × 10^-324 m');
  await expect(row('1 m')).toContainText('2.22 × 10^-16 m');
  await expect(row('1 m')).toContainText('asymmetric');
  await expect(row('1e20 m')).toContainText('1.638 × 10^4 m');
});

test('the microscope says when binary64 has stopped being floating point', async ({ page }) => {
  await openMicroscope(page);
  const binary64 = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'binary64', exact: true }) });

  // At three metres it is the machine everyone describes: spacing set by
  // magnitude. (One metre is a power of two, which has its own note.)
  await page.getByLabel('Value', { exact: true }).fill('3');
  await expect(binary64).toContainText('Spacing grows with magnitude');

  await page.getByLabel('Value', { exact: true }).fill('1e-310');
  await page.getByLabel('Unit', { exact: true }).selectOption('m');

  // Down here it is not. Saying "spacing grows with magnitude" at 1e-310 would
  // be teaching the opposite of what the lens exists to show.
  await expect(binary64).not.toContainText('Spacing grows with magnitude');
  await expect(binary64).toContainText('subnormal');
  await expect(binary64).toContainText('2^-1074');
  await expect(
    binary64.locator('tr').filter({ has: page.getByRole('rowheader', { name: 'Regime' }) }),
  ).toContainText('fixed spacing');

  // Both neighbours the same distance away, ten decades from the boundary.
  const gap = (name: string) =>
    binary64.locator('tr').filter({ has: page.getByRole('rowheader', { name }) });
  await expect(gap('Gap below')).toContainText('4.941 × 10^-324 m');
  await expect(gap('Gap above')).toContainText('4.941 × 10^-324 m');
});

test('switching the Q128.128 base unit trades range against resolution', async ({ page }) => {
  await openMicroscope(page);

  const gapAbove = (heading: string) =>
    page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Gap above' }) });

  await expect(gapAbove('Q128.128 @ m')).toContainText('2.939 × 10^-39 m');

  await page.getByLabel('Q128.128 base unit').selectOption('km');

  // A thousand times coarser, and a thousand times further reaching.
  await expect(gapAbove('Q128.128 @ km')).toContainText('2.939 × 10^-36 m');

  const table = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Same 256 bits. Pick your ruler.' }) });
  await expect(
    table
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Q128.128 @ mm', exact: true }) }),
  ).toContainText('10^-42');
  await expect(
    table
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Q128.128 @ km', exact: true }) }),
  ).toContainText('10^-36');
});

test('the microscope charts resolution against magnitude', async ({ page }) => {
  await openMicroscope(page);

  const chart = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Local resolution against magnitude' }) });

  await expect(
    chart.getByRole('img', { name: 'Local resolution against magnitude' }),
  ).toBeVisible();
  await expect(chart).toContainText('binary64 (grows)');
  await expect(chart).toContainText('Q128.128 @ m (constant)');
  await expect(chart).toContainText('Planck grid (constant)');
  await expect(chart).toContainText('Neither representation is simply better');
});

test('the lab runs an experiment and shows every machine disagreeing', async ({ page }) => {
  await openLab(page);
  await page.getByLabel('Experiment').selectOption({ label: 'Add 1 mm one million times' });

  const rows = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Abuse the Computer' }),
  });

  await expect(readoutRow(page, 'Exact reference')).toContainText('1 × 10^3 m');
  await expect(rows).toContainText('3,000,003 real machine operations');
  await expect(rows).toContainText('lower bound');

  // Expanding a representation splits its error into the two categories.
  await rows.getByRole('button', { name: 'binary64' }).click();
  await expect(readoutRow(page, 'Operand encoding')).toBeVisible();
  await expect(readoutRow(page, 'Operation rounding')).toBeVisible();
  await expect(readoutRow(page, 'Q512.512 meters')).toBeVisible();
  await expect(readoutRow(page, 'Raw register')).toContainText('0x');
});

test('a long experiment runs off the main thread', async ({ page }) => {
  await openLab(page);

  const panel = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Abuse the Computer' }),
  });

  await page.getByLabel('Experiment').selectOption({ label: 'Add 1 mm one million times' });

  // A million steps is well over a second of solid BigInt arithmetic. If it
  // were running here, this click could not be answered until it finished.
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 2000 });
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Scale Atlas' })
    .click({ timeout: 1000 });
  await expect(page.getByRole('application', { name: /Scale atlas/ })).toBeVisible({
    timeout: 1000,
  });
});

test('a running experiment reports progress and can be cancelled', async ({ page }) => {
  await openLab(page);

  const panel = page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: 'Abuse the Computer' }),
  });

  await page.getByLabel('Experiment').selectOption({ label: 'Add 1 mm one million times' });
  await expect(panel.getByRole('status')).toContainText(/starting|iterations/);

  await panel.getByRole('button', { name: 'Cancel' }).click();

  // Cancelling settles rather than leaving the panel stuck on "Running…".
  await expect(panel.getByRole('button', { name: 'Run again' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('zoom to disagreement always discloses its magnification', async ({ page }) => {
  await openLab(page);
  await page.getByLabel('Experiment').selectOption({ label: 'Add 1 mm one million times' });

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Zoom to disagreement' }) });

  // True scale first: the machines really are on the same pixel.
  await expect(panel).toContainText('Drawn at true scale');
  await expect(panel).toContainText('every representation occupies the same pixel');
  await expect(page.getByText(/magnified .* for visibility/)).toHaveCount(0);

  await panel.getByRole('button', { name: 'Zoom to disagreement' }).click();

  // Magnified: the disclosure is mandatory, and names the real divergence.
  const disclosure = panel.locator('p.magnification-disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('magnified');
  await expect(disclosure).toContainText('for visibility');
  await expect(disclosure).toContainText('The widest divergence is');
  await expect(disclosure).toContainText('lP');
  await expect(panel).toContainText(/Drawn \d+ px apart/);

  await panel.getByRole('button', { name: 'Back to true scale' }).click();
  await expect(panel.locator('p.magnification-disclosure')).toHaveCount(0);
});

test('a rounded figure under a heading that says exact is marked as rounded', async ({ page }) => {
  await openLab(page);
  // 1/3 + 1/3 + 1/3: the exact reference after one step is 1/3 m, which has no
  // finite decimal, so the "Exact" column has something to be honest about.
  await page.getByLabel('Experiment').selectOption('thirds');
  await page.getByRole('button', { name: 'Run again' }).click();

  // The timeline's "Exact" column renders to a few significant digits, so where
  // the digits are a reading of the value rather than the value, it says so.
  const timeline = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Timeline' }) });
  await expect(timeline).toBeVisible();

  const exactCells = timeline.locator('tbody tr td:nth-child(2)');
  const count = await exactCells.count();
  expect(count).toBeGreaterThan(0);

  let marked = 0;
  for (let index = 0; index < count; index += 1) {
    const text = (await exactCells.nth(index).textContent()) ?? '';
    const digits = /(\d)\.(\d+)/.exec(text);
    if (digits === null) continue;
    // Four significant digits is the formatter's default; anything shown that
    // way is a reading, and the cell has to carry the mark.
    if (digits[2]!.length >= 3) {
      expect(text, text).toContain('rounded');
      marked += 1;
    }
  }
  // Otherwise this passes by finding nothing to check, which is how a test for
  // a missing label ends up asserting that the label is missing.
  expect(marked, 'no rounded cell to check').toBeGreaterThan(0);
});

test('the timeline shows checkpoints, not a million rows', async ({ page }) => {
  await openLab(page);
  await page.getByLabel('Experiment').selectOption({ label: 'Add 1 mm one million times' });

  const timeline = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Timeline' }) });

  const rows = timeline.locator('tbody tr');
  await expect(rows).not.toHaveCount(0);
  expect(await rows.count()).toBeLessThan(30);
  await expect(timeline).toContainText('iteration 1,000,000');
  await expect(timeline).toContainText('the arithmetic is never compact, the trace always is');
});

test('an experiment where the machines agree offers nothing to zoom into', async ({ page }) => {
  await openLab(page);
  await page.getByLabel('Experiment').selectOption({ label: '(1 / 10) x 10' });

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Zoom to disagreement' }) });

  // binary64 rounds twice and lands back on 1 exactly; the fixed-point machines
  // do not, so there is still something to see.
  await expect(panel.getByRole('button', { name: 'Zoom to disagreement' })).toBeEnabled();
  await expect(readoutRow(page, 'Exact reference')).toContainText('1 × 10^0 m');
});

test('a large-offset disagreement view survives being sent as a link', async ({ page }) => {
  // The acceptance criterion from docs/IMPLEMENTATION_PLAN.md, end to end.
  await openLab(page);
  await page.getByLabel('Experiment').selectOption({ label: 'Large offset eats the millimeter' });
  await page.getByLabel('Value').fill('1e20');
  await page.getByLabel('Fed from').selectOption('mm');

  // Park the ruler somewhere only exact arithmetic could describe.
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();
  await page.getByLabel('Preset').selectOption('far-origin');
  await expect(readoutRow(page, 'Centre')).toContainText('100 Em');

  await page.getByRole('button', { name: 'Share this view' }).click();
  const url = await page.getByLabel('Share URL').inputValue();

  // A fragment, so no server is ever involved.
  expect(url).toContain('#1.');
  expect(url).not.toContain('?');

  // Open the link as a stranger would.
  await page.goto(url);

  await expect(page.locator('svg.ruler')).toBeVisible();
  await expect(page.getByLabel('Preset')).toHaveValue('far-origin');
  await expect(readoutRow(page, 'Centre')).toContainText('100 Em');
  // Still millimetre-scale across, at the preset's 10 µm per pixel. The figure
  // is the scale times the width the view is drawn at, not a fixed number.
  const across = metresIn((await readoutRow(page, 'Across the view').textContent()) ?? '');
  expect(across).toBeCloseTo(1e-5 * (await rulerWidth(page)), 4);

  // And the rest of the view came with it.
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Representation Lab' })
    .click();
  await expect(page.getByLabel('Experiment')).toHaveValue('large-offset');
  await expect(page.getByLabel('Value')).toHaveValue('1e20');
  await expect(page.getByLabel('Fed from')).toHaveValue('mm');
});

test('a shared link carries a hand-panned camera back exactly', async ({ page }) => {
  await openRuler(page);
  await page.getByLabel('Preset').selectOption('far-origin');

  const box = await page.locator('svg.ruler').boundingBox();
  if (box === null) throw new Error('ruler has no box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 300, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 437, y, { steps: 9 });
  await page.mouse.up();

  const centre = await readoutRow(page, 'Centre').textContent();
  await page.getByRole('button', { name: 'Share this view' }).click();
  const url = await page.getByLabel('Share URL').inputValue();

  await page.goto(url);
  // A camera panned by an arbitrary number of pixels out at 1e20 m comes back
  // as the identical rational, not as something that rounds to the same double.
  await expect(readoutRow(page, 'Centre')).toHaveText(centre ?? '');
});

test('a malformed link says so instead of silently loading something else', async ({ page }) => {
  await page.goto('/#1.bm90LWpzb24');
  await expect(page.getByRole('status')).toContainText('Could not restore that link');
  // And it falls back to a usable app rather than a blank page.
  await expect(page.getByRole('application', { name: /Scale atlas/ })).toBeVisible();
});

test('a link from a future schema is refused rather than guessed at', async ({ page }) => {
  await page.goto('/#99.abcdef');
  await expect(page.getByRole('status')).toContainText('Unsupported share schema version 99');
});

test('the atlas spans the catalog on one logarithmic axis', async ({ page }) => {
  await page.goto('/');

  // The Atlas is the landing lens.
  await expect(page.getByRole('application', { name: /Scale atlas/ })).toBeVisible();

  // Engineering boundaries are labelled with prefixes, across the whole range.
  const axis = page.locator('svg.atlas');
  for (const label of ['nm', 'µm', 'mm', 'm', 'km', 'Mm', 'Gm']) {
    await expect(axis.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // Everything is accounted for, whether merged into a cluster or not.
  await expect(page.getByText(/28 of 28 objects in view/)).toBeVisible();
  await expect(page.getByText(/crowded ones merge rather than being dropped/)).toBeVisible();
});

test('the atlas walks the object graph from the selection', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Related at this scale' }) });

  // Nothing selected: the panel says what it needs rather than showing nothing.
  await expect(panel).toContainText('Select an object to walk the graph');

  await page.getByLabel('Object', { exact: true }).selectOption('human');
  await page.getByRole('button', { name: 'Centre on selection' }).click();

  // Relations, both authored and derived, with their direction named.
  await expect(panel).toContainText('Hand');
  await expect(panel).toContainText('has part');
  await expect(panel).toContainText('Red blood cell');

  // The chain from PROJECT_SPEC section 14, found by search rather than listed.
  await expect(panel).toContainText('Ontology navigation');
  await expect(panel).toContainText(
    'Human \u2192 Hand \u2192 Finger \u2192 Skin cell \u2192 DNA double helix',
  );

  // Clicking a related object walks to it. Scoped to the relations table: the
  // "also at this size" table below can name the same object.
  await panel.locator('table.readout').first().getByRole('button', { name: 'Hand' }).click();
  await expect(page.locator('p.selection-banner')).toContainText('Hand');
  await expect(panel).toContainText('part of');
});

test('what is within reach changes as the atlas zooms', async ({ page }) => {
  await page.goto('/');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Related at this scale' }) });
  // The relations table, not the "also at this size" one below it.
  const row = (name: string) =>
    panel
      .locator('table.readout')
      .first()
      .locator('tr')
      .filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  await page.getByLabel('Object', { exact: true }).selectOption('human');
  await page.getByRole('button', { name: 'Centre on selection' }).click();

  // A hand is here; a red blood cell is several decades of zoom away.
  await expect(row('Hand')).toContainText('in view');
  await expect(row('Red blood cell')).toContainText('zoom in');

  // Centre on the cell instead and the reachability inverts.
  await page.getByLabel('Object', { exact: true }).selectOption('red-blood-cell');
  await page.getByRole('button', { name: 'Centre on selection' }).click();
  await expect(row('Human')).toContainText('zoom out');
});

test('objects with no relations say so instead of inventing them', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Object', { exact: true }).selectOption('coconut');

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Related at this scale' }) });
  await expect(panel).toContainText('Nothing in the catalog is related to Coconut');
  await expect(panel).toContainText('an empty list is more honest than an invented one');
});

test('the atlas reveals what else lives at a size, related or not', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Object', { exact: true }).selectOption('red-blood-cell');
  await page.getByRole('button', { name: 'Centre on selection' }).click();

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Related at this scale' }) });

  // Metric navigation: neighbours by size alone, with no relation between them.
  await expect(panel).toContainText('Also at this size');
  await expect(panel).toContainText('Skin cell');
  await expect(panel).toContainText('Bacterium');
  await expect(panel).toContainText('Zooming is both metric and ontology navigation');
});

test('clicking a marker selects what it stands for', async ({ page }) => {
  await page.goto('/');

  const atlas = page.locator('svg.atlas');
  const box = await atlas.boundingBox();
  if (box === null) throw new Error('atlas has no box');

  // At full range most markers are clusters; clicking one selects the object it
  // is named after, whatever that turns out to be.
  const label = atlas
    .locator('text')
    .filter({ hasText: /^Planck length/ })
    .first();
  const labelBox = await label.boundingBox();
  if (labelBox === null) throw new Error('no planck label');
  await page.mouse.click(labelBox.x + 2, box.y + box.height * (150 / 240));

  await expect(page.locator('p.selection-banner')).toContainText('Planck length');
  await expect(readoutRow(page, 'Object')).toContainText('Planck length');
});

test('the atlas says what backs every number it shows', async ({ page }) => {
  await page.goto('/');
  const provenance = readoutRow(page, 'Where it comes from');

  // A cited measurement names what a reader would check it against.
  await page.getByLabel('Object', { exact: true }).selectOption('earth');
  await expect(provenance).toContainText('Measured.');
  await expect(provenance).toContainText('WGS 84');

  // A defined constant says it is defined.
  await page.getByLabel('Object', { exact: true }).selectOption('astronomical-unit');
  await expect(provenance).toContainText('Exactly defined.');
  await expect(provenance).toContainText('IAU 2012');

  // And a plausible round number says that it is one, in the same place, rather
  // than being shown with the same certainty as the two above.
  await page.getByLabel('Object', { exact: true }).selectOption('red-blood-cell');
  await expect(provenance).toContainText('A representative figure.');
  await expect(provenance).toContainText('No source recorded');
  await expect(readoutRow(page, 'Size')).toContainText('ranges');
});

test('every lens that shows a curated number says what backs it', async ({ page }) => {
  // The same red blood cell, in three lenses. It is a plausible round number in
  // all three, so all three have to say so — a lens that stays quiet about it is
  // showing it with the same certainty as a defined constant.
  const uncited = /A representative figure\. No source recorded/;

  await page.goto('/');
  await page.getByLabel('Object', { exact: true }).selectOption('red-blood-cell');
  await expect(readoutRow(page, 'Where it comes from')).toContainText(uncited);

  await openRuler(page);
  await expect(readoutRow(page, 'Red blood cell size')).toContainText(uncited);

  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();
  await page.getByLabel('A', { exact: true }).selectOption('object:red-blood-cell');
  await page.getByLabel('B', { exact: true }).selectOption('unit:mm');
  await expect(readoutRow(page, 'Red blood cell (diameter)')).toContainText(uncited);

  // And a unit literal is a definition, not a plausible round number, so the
  // caveat must not appear against it.
  const millimetre = readoutRow(page, '1 mm');
  await expect(millimetre).toContainText('Exactly defined.');
  await expect(millimetre).not.toContainText('No source recorded');
});

test('selecting in the atlas carries the object into the other lenses', async ({ page }) => {
  await page.goto('/');

  // Nothing is selected to begin with.
  await expect(page.locator('p.selection-banner')).toHaveCount(0);

  await page.getByLabel('Object', { exact: true }).selectOption('coconut');

  const banner = page.locator('p.selection-banner');
  await expect(banner).toContainText('Coconut');
  await expect(readoutRow(page, 'Size')).toContainText('200 mm');

  // It survives the jump to every other lens.
  const nav = page.getByRole('navigation', { name: 'Lenses' });
  await nav.getByRole('button', { name: 'Comparator' }).click();
  await expect(banner).toContainText('Coconut');
  await expect(page.getByLabel('A', { exact: true })).toHaveValue('object:coconut');

  await nav.getByRole('button', { name: 'Representation Lab' }).click();
  await expect(banner).toContainText('Coconut');

  await nav.getByRole('button', { name: 'Scale Atlas' }).click();
  await expect(banner).toContainText('Coconut');
});

test('the atlas can hand an object to the ruler', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Object', { exact: true }).selectOption('coconut');
  await page.getByRole('button', { name: 'Open in Ruler' }).click();

  // The ruler is now showing, framed on the selection.
  await expect(page.locator('svg.ruler')).toBeVisible();
  await expect(page.getByLabel('Preset')).toHaveValue('selection');
  await expect(page.getByText('Framed on the selection from the Atlas')).toBeVisible();

  // "Framed on the selection" has to mean the selection fills the frame, which
  // is a fact about the drawing rather than about any particular width.
  const coconut = await page.locator('svg.ruler ellipse, svg.ruler rect').nth(1).boundingBox();
  expect(coconut).not.toBeNull();
  const fraction = coconut!.width / (await rulerWidth(page));
  expect(fraction).toBeGreaterThan(0.4);
  expect(fraction).toBeLessThan(0.75);
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
  // ...and the view across it is only millimetres wide: 10 µm per pixel, times
  // however many pixels the view was actually given.
  const across = metresIn((await readoutRow(page, 'Across the view').textContent()) ?? '');
  expect(across).toBeCloseTo(1e-5 * (await rulerWidth(page)), 4);
  expect(across).toBeLessThan(0.1);
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

test('a repeating answer is not shown as though it terminated', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();

  // 1 mm across a 7.5 µm cell is 400/3, which has no finite decimal. The row is
  // headed "Exact value", so the digits under it must say they are a reading of
  // the answer rather than the answer.
  await page.getByLabel('A', { exact: true }).selectOption('object:red-blood-cell');
  await page.getByLabel('B', { exact: true }).selectOption('unit:mm');
  await page.getByLabel('Operation').selectOption('how-many-fit');

  const exactValue = readoutRow(page, 'Exact value');
  await expect(exactValue).toContainText('133.333333333');
  await expect(exactValue).toContainText('rounded');
  await expect(exactValue).toContainText('exactly 400/3');

  // And one that does terminate carries no mark at all. An "exact" tag here
  // would sit beside the headline's "approximate" tag, about the same number:
  // one about the digits, one about the red blood cell. Same words, different
  // axes, inches apart.
  await page.getByLabel('A', { exact: true }).selectOption('unit:km');
  await expect(exactValue).not.toContainText('rounded');
  await expect(exactValue).not.toContainText('exactly ');
});

test('laying N items end to end draws them against the total, not against one', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Comparator' })
    .click();
  await page.getByLabel('A', { exact: true }).selectOption('object:red-blood-cell');
  await page.getByLabel('Operation').selectOption('end-to-end');
  await page.getByLabel('N', { exact: true }).fill('123');

  const strip = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'To scale' }) });

  // `endToEnd` has no second subject, so the strip used to draw the cell against
  // itself and report "1 shown" — two identical bars, identically labelled.
  await expect(strip).toContainText('123 × Red blood cell');
  await expect(strip).not.toContainText('1 shown');
  await expect(strip).toContainText('123 shown');
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
  await openLab(page);

  const panel = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Abuse the Computer' }) });
  const row = (name: string) =>
    panel.locator('tr').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  // 0.1 + 0.2 is the default experiment. Exactly three tenths in the reference,
  // and not that in binary64.
  await expect(row('Exact reference')).toContainText('3 × 10^-1 m');
  await expect(row('binary64')).toContainText('4.441 × 10^-17 m');

  // The fixed-point machines disagree too, and differently.
  await expect(row('Q128.128 @ m')).toBeVisible();
  await expect(row('Planck grid (256-bit)')).toBeVisible();

  // The exact reference is truth, not a machine with error.
  await expect(row('Exact reference')).toContainText('truth');

  await page.getByLabel('Experiment').selectOption({ label: 'Large offset eats the millimeter' });
  await expect(row('Exact reference')).toContainText('1 × 10^-3 m');
  // binary64 loses the millimetre entirely; fixed point does not.
  await expect(row('binary64')).toContainText('0 m');
});

test('the floating-origin demonstration recovers the millimetre', async ({ page }) => {
  await openLab(page);

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
  await openLab(page);

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
  await openLab(page);

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
  await openLab(page);

  const planck = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'Planck grid (256-bit integer)' }) });

  await expect(planck).toContainText('not a claim that spacetime is discrete');
  await expect(planck).toContainText('CODATA 2018');
  await expect(planck.getByRole('rowheader', { name: 'This value' })).toBeVisible();
});

test('the division identity holds at every step, and says so', async ({ page }) => {
  // §22 asks for `A = Q x B + R` to be displayed continuously. The panel does
  // not assert that from a comment: it recomputes the identity from the state it
  // is drawing and reports the verdict, so a trace that drifted from the machine
  // would show here rather than looking plausible.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();

  const slider = page.getByLabel('Quotient digit');
  const verdict = readoutRow(page, 'A = Q × B + R');
  const tape = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'One quotient digit at a time' }) })
    .locator('svg');

  await expect(verdict).toContainText('holds');

  const max = Number(await slider.getAttribute('max'));
  expect(max).toBeGreaterThan(100);

  for (const position of [1, 7, Math.floor(max / 2), max - 1, max]) {
    await slider.fill(String(position));
    await expect(verdict, `step ${position}`).toContainText('holds');
    await expect(tape, `step ${position}`).toContainText(`step ${position} of ${max}`);
  }
});

test('the tape actually fills in as the quotient is produced', async ({ page }) => {
  // Anti-vacuity for the drawing. An empty strip and a broken strip look
  // identical, and the default operands genuinely produce nothing but zeros for
  // three hundred steps: the first set quotient bit cannot appear until the part
  // of the dividend read so far exceeds B, which is about 2^300.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  const tape = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'One quotient digit at a time' }) })
    .locator('svg');

  const setBits = async () =>
    tape.evaluate(
      (svg) =>
        Array.from(svg.querySelectorAll('rect'))
          .slice(0, 48)
          .filter((cell) => cell.getAttribute('fill-opacity') === '0.6').length,
    );

  await expect(page.getByLabel('Quotient digit')).toHaveValue('0');
  expect(await setBits(), 'before the machine starts').toBe(0);

  await page.getByLabel('Quotient digit').fill('400');
  expect(await setBits(), 'well into the quotient').toBe(48);
});

test('a higher radix takes fewer iterations to reach the same answer', async ({ page }) => {
  // §10's benchmark, in the place where someone can see it. The four algorithms
  // agree on the quotient and disagree about the work, which is the only reason
  // to have more than one of them.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();

  const steps = async () => Number(await page.getByLabel('Quotient digit').getAttribute('max'));
  const shiftsAndCompares = () => readoutRow(page, 'Shifts / compares').locator('td').innerText();

  expect(await steps()).toBe(717);
  expect(await shiftsAndCompares()).toBe('717 / 717');

  await page.getByLabel('Algorithm').selectOption('restoring-radix-4');
  expect(await steps()).toBe(359);
  expect(await shiftsAndCompares()).toBe('359 / 718');

  await page.getByLabel('Algorithm').selectOption('restoring-radix-8');
  expect(await steps()).toBe(239);
  expect(await shiftsAndCompares()).toBe('239 / 717');

  // And the identity is still the identity, whatever the radix.
  await page.getByLabel('Quotient digit').fill('120');
  await expect(readoutRow(page, 'A = Q × B + R')).toContainText('holds');
});

test('a cell is shaded by what its digit is worth, not by one bit', async ({ page }) => {
  // Anti-vacuity for the higher radices. At radix 2 every digit is a zero or a
  // one and the weighting does nothing, so a broken weighting would look exactly
  // like a working one in the default view.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  const tape = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'One quotient digit at a time' }) })
    .locator('svg');
  const shades = () =>
    tape.evaluate((svg) =>
      Array.from(svg.querySelectorAll('rect'))
        .slice(0, 48)
        .map((cell) => Number(cell.getAttribute('fill-opacity'))),
    );

  await page.getByLabel('Algorithm').selectOption('restoring-radix-8');
  await page.getByLabel('B', { exact: true }).fill('2^64 + 3');
  await page.getByLabel('Quotient digit').fill('239');
  expect(new Set(await shades()).size, 'octal digits of an awkward reciprocal').toBeGreaterThan(2);

  // And a case where every digit is the same and still not a full cell: an
  // eighth of the quotient's alphabet. One seventh in octal is 0.111..., so at
  // radix 8 dividing by seven produces a one every single step — never empty,
  // never full.
  await page.getByLabel('B', { exact: true }).fill('7');
  await page.getByLabel('Quotient digit').fill('200');
  const sevenths = await shades();
  expect(new Set(sevenths).size).toBe(1);
  expect(sevenths[0]!).toBeGreaterThan(0.08);
  expect(sevenths[0]!).toBeLessThan(0.6);
});

test('the compute lanes carry all the way across, and say what was not verified', async ({
  page,
}) => {
  // All-ones plus one: §19's longest carry chain, drawn lane by lane. And this
  // suite runs in Playwright's bundled Chromium, where the adapter exists but
  // device creation fails on a missing dxil.dll — so this test pins the honest
  // path: the panel must say nothing was GPU-verified, not pretend.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  await page.getByLabel('A', { exact: true }).fill('2^1024 - 1');
  await page.getByLabel('B', { exact: true }).fill('1');

  await expect(readoutRow(page, 'Lanes that carried')).toContainText('32 of 32');
  await expect(readoutRow(page, 'Lanes that carried')).toContainText('longest chain 32');
  await expect(readoutRow(page, 'A + B')).toContainText('wrapped');

  // Two machines, one product, in the live app rather than only in a test.
  await expect(readoutRow(page, 'Same product, two machines')).toContainText('agree bit-for-bit');

  await expect(readoutRow(page, 'GPU')).toContainText('no WebGPU device in this browser');
  await expect(readoutRow(page, 'GPU')).toContainText('nothing on this page has been GPU-verified');
});

test('the reciprocal method says it has no digits to step through', async ({ page }) => {
  // A method that estimates the whole quotient at once has no serial digits, so
  // the panel drops the tape rather than drawing an animation of something the
  // machine never does — and still shows the finished identity.
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  await page.getByLabel('Algorithm').selectOption('reciprocal-newton');

  await expect(page.getByLabel('Quotient digit')).toHaveCount(0);
  await expect(page.getByText('produces no quotient digits in order')).toBeVisible();
  await expect(readoutRow(page, 'A = Q × B + R')).toContainText('holds');

  // Its work is multiplications, and it needs a temporary wider than the
  // register the whole project is named after. Twenty-four rather than the
  // twenty the unit tests measure, because the panel scales the numerator by
  // 2^16 first (§11) and so divides a larger number.
  await expect(readoutRow(page, 'Multiplies').locator('td')).toHaveText(/^24 costing/);
  await expect(readoutRow(page, 'Widest temporary')).toContainText('wider than the 1024-bit');
  await expect(page.locator('[data-lens-failed]')).toHaveCount(0);
});

test('a divisor of zero has no quotient and does not take the lens down', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  await page.getByLabel('B', { exact: true }).fill('0');

  await expect(page.getByText('DIV_REM by zero has no quotient')).toBeVisible();
  // The rest of the lab is unaffected, which is the difference between a value
  // the machine refuses and a lens that broke.
  await expect(page.getByRole('heading', { name: 'The same arithmetic, four ways' })).toBeVisible();
  await expect(page.locator('[data-lens-failed]')).toHaveCount(0);
});

test('a shared link carries the division position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Architecture Lab' }).click();
  await page.getByLabel('Quotient digit').fill('412');
  await page.getByRole('button', { name: 'Share this view' }).click();
  const url = await page.getByLabel('Share URL').inputValue();

  await page.goto(url);
  await expect(page.getByLabel('Quotient digit')).toHaveValue('412');
});
