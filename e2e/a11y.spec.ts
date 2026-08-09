import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

const LENSES = [
  'Scale Atlas',
  'Metric Ruler',
  'Comparator',
  'Numerical Microscope',
  'Representation Lab',
] as const;

const openLens = async (page: Page, lens: string) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: lens })
    .click();
};

/** WCAG 2 A and AA, which is the bar a public teaching tool should clear. */
const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

for (const lens of LENSES) {
  test(`${lens} has no accessibility violations`, async ({ page }) => {
    await openLens(page, lens);
    const results = await scan(page);

    // Report what failed rather than just the count — a bare number is useless
    // when the run is red.
    const summary = results.violations.map(
      (violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} node(s)`,
    );
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

test('every lens is reachable and operable from the keyboard alone', async ({ page }) => {
  await page.goto('/');

  // Tab into the lens navigation and walk it.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Scale Atlas' })).toBeFocused();

  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Representation Lab' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Exact quantity core' })).toBeVisible();
});

test('the ruler can be panned and zoomed without a pointer', async ({ page }) => {
  await openLens(page, 'Metric Ruler');

  const readoutRow = (header: string) =>
    page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name: header, exact: true }) });

  const ruler = page.getByRole('application', { name: /Metric ruler/ });
  await ruler.focus();
  await expect(ruler).toBeFocused();

  const before = await readoutRow('Centre').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(readoutRow('Centre')).not.toHaveText(before ?? '');

  // And back again — exactly, because the centre is a rational.
  await page.keyboard.press('ArrowLeft');
  await expect(readoutRow('Centre')).toHaveText(before ?? '');

  const scale = await readoutRow('Scale').textContent();
  await page.keyboard.press('Equal');
  await expect(readoutRow('Scale')).not.toHaveText(scale ?? '');
});

test('the atlas can be panned, zoomed and selected without a pointer', async ({ page }) => {
  await openLens(page, 'Scale Atlas');

  const atlas = page.getByRole('application', { name: /Scale atlas/ });
  await atlas.focus();
  await expect(atlas).toBeFocused();

  const span = page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Visible span', exact: true }) });
  const before = await span.textContent();

  await page.keyboard.press('ArrowRight');
  await expect(span).not.toHaveText(before ?? '');

  // Selection has a keyboard route too — the picker, not just the markers.
  await page.getByLabel('Object', { exact: true }).selectOption('coconut');
  await expect(page.locator('p.selection-banner')).toContainText('Coconut');
});

test('hostile input never white-screens a lens', async ({ page }) => {
  // Every lens is wrapped in an error boundary, but the better outcome is that
  // it is never needed. These are the values most likely to reach a division,
  // a logarithm or an encoder that cannot take them.
  for (const lens of ['Numerical Microscope', 'Representation Lab']) {
    await openLens(page, lens);
    const input = page.getByLabel('Value', { exact: true });

    for (const value of ['0', '-1', '-0.5', '1e400', '1e-400', '', 'abc']) {
      await input.fill(value);

      // The lens may cope or it may explain — an unparseable value hides the
      // panels that would have shown it, which is right. What it must not do is
      // vanish or fall through to the error boundary.
      await expect(input, `${lens} lost its input for ${JSON.stringify(value)}`).toBeVisible();
      await expect(
        page.locator('[role="alert"]'),
        `${lens} threw on ${JSON.stringify(value)}`,
      ).toHaveCount(0);
    }
  }
});

test('a share link naming an object that no longer exists still opens', async ({ page }) => {
  // Catalog ids are not guaranteed stable forever, and a link outlives a build.
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      lens: 'comparator',
      selected: 'nonexistent-object',
      atlas: { centerLog10: 0, pixelsPerDecade: 20 },
      ruler: { presetId: 'human-scale', centerMeters: '1', metersPerPixelLog10: -3 },
      comparator: {
        a: { kind: 'object', value: 'nonexistent-object' },
        b: { kind: 'unit', value: 'mm' },
        operation: 'how-many-fit',
        countText: '1',
      },
      lab: {
        experimentId: 'thirds',
        literal: '1',
        unit: 'm',
        displayUnit: 'mm',
        zoomToDisagreement: false,
      },
      microscope: { literal: '1', unit: 'm' },
      representations: { q128Preset: 'm' },
    }),
    'utf-8',
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await page.goto(`/#1.${payload}`);

  // The comparator explains rather than vanishing, and the app stays usable.
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  await expect(page.locator('p.error')).toContainText('nonexistent-object');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Scale Atlas' })
    .click();
  await expect(page.getByRole('application', { name: /Scale atlas/ })).toBeVisible();
});
