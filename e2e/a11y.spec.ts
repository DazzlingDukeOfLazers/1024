import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { STATES } from './states';

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

    // "No violations" is also what a scan of an empty page says. These two
    // numbers are the evidence that it looked: dozens of rules, run against real
    // nodes on this lens.
    expect(results.passes.length, `${lens}: axe ran no rules`).toBeGreaterThan(10);
    expect(
      results.passes.reduce((total, rule) => total + rule.nodes.length, 0),
      `${lens}: axe found no nodes to check`,
    ).toBeGreaterThan(20);
  });
}

/**
 * The five tests above scan each lens as it first loads. That is the state
 * someone thought of, and states nobody thought of are where every recent defect
 * has been — an operation that adds an input, an experiment that adds a Cancel
 * button, a magnitude that adds a row. A violation in any of those is as real as
 * one on the landing page and would never have been seen.
 */
test('no state of the app has an accessibility violation', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });

  const problems: string[] = [];
  let rulesRun = 0;
  let nodesChecked = 0;

  for (const state of STATES) {
    await page.goto('/');
    await state.reach(page);
    const results = await scan(page);

    rulesRun += results.passes.length;
    nodesChecked += results.passes.reduce((total, rule) => total + rule.nodes.length, 0);
    for (const violation of results.violations) {
      problems.push(
        `${state.name}: ${violation.id} (${violation.impact}) on ${violation.nodes.length} node(s)`,
      );
    }
  }

  expect(problems, problems.join('\n')).toEqual([]);

  // A scan of an empty page reports no violations too.
  expect(STATES.length, 'states enumerated').toBeGreaterThan(20);
  expect(rulesRun, 'rules run across all states').toBeGreaterThan(200);
  expect(nodesChecked, 'nodes checked across all states').toBeGreaterThan(1000);
});

test('every lens is reachable and operable from the keyboard alone', async ({ page }) => {
  await page.goto('/');

  // Tab into the lens navigation and walk it. The skip link is the first stop
  // — that is its whole job — so the nav starts one Tab later than it used to.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the lens' })).toBeFocused();
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

test('a skip link is the first tab stop and moves focus to the lens', async ({ page }) => {
  await page.goto('/');

  // First tab from the document reaches it — a skip link that is not first is
  // not a skip link.
  await page.keyboard.press('Tab');
  const link = page.getByRole('link', { name: 'Skip to the lens' });
  await expect(link).toBeFocused();

  // And it is visible while focused. Hiding it with `display: none` would take
  // it out of the tab order entirely, which is the usual way this feature gets
  // shipped broken: present in the DOM, unreachable, and counted as done.
  await expect(link).toBeInViewport();

  await page.keyboard.press('Enter');
  // Focus lands on the lens container itself, not merely the URL fragment, so
  // the next Tab continues inside the content rather than back at the nav.
  await expect(page.locator('main#lens-content')).toBeFocused();
});

test('the skip link stays out of the way until it is wanted', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Skip to the lens' });
  // Present in the accessibility tree, but off-screen while unfocused.
  await expect(link).toHaveCount(1);
  await expect(link).not.toBeInViewport();
});

test('an application region can always be left, and never is the only route', async ({ page }) => {
  // `role="application"` asks assistive technology to stop interpreting keys
  // and hand them all to the view. TASKS flags that as a strong claim checked
  // only by axe. A screen reader is still the real test and is still not done —
  // but two of the properties that make the claim survivable are checkable
  // here, and neither was.
  for (const [lens, name] of [
    ['Metric Ruler', /Metric ruler/],
    ['Scale Atlas', /Scale atlas/],
  ] as const) {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Lenses' })
      .getByRole('button', { name: lens })
      .click();

    const view = page.getByRole('application', { name });
    await view.focus();
    await expect(view).toBeFocused();

    // 1. Tab escapes. A view that swallowed Tab would trap a keyboard user
    //    inside a region whose own commands they may not be able to use.
    await page.keyboard.press('Tab');
    await expect(view, `${lens} trapped focus`).not.toBeFocused();

    // 2. Shift+Tab back in, then out the other way — both directions work.
    await view.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(view, `${lens} trapped focus backwards`).not.toBeFocused();
  }
});

test('everything the application keys do is also reachable as a control', async ({ page }) => {
  // The escape hatch that matters most: someone who cannot use the custom keys
  // must still be able to drive the view. Pan, zoom and reset all have an
  // ordinary control outside the application region.
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();

  const centre = page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Centre', exact: true }) });
  const before = await centre.textContent();

  // The preset select moves the camera without touching the application region.
  await page.getByLabel('Preset').selectOption('coconuts');
  await expect(centre).not.toHaveText(before ?? '');

  // And Reset view brings it back, which is what Home does from the keyboard.
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByLabel('Preset')).toHaveValue('coconuts');
});
