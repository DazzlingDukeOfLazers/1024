import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * The views claim things in pixels — "below a pixel here", "N px per red blood
 * cell", "drawn N px apart". A fixed viewBox scaled by CSS makes those claims
 * false on any screen that is not exactly the nominal width.
 *
 * These tests hold the reported figure against the measured geometry.
 */

/**
 * Wait until the view has measured itself, i.e. until one viewBox unit is one
 * CSS pixel. The measurement arrives from a ResizeObserver, so the very first
 * paint still uses the nominal fallback width and asserting before this settles
 * would measure the guess rather than the fix.
 */
async function settled(svg: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const box = await svg.boundingBox();
      const viewBox = await svg.getAttribute('viewBox');
      if (box === null || viewBox === null) return -1;
      return Math.abs(box.width - Number(viewBox.split(' ')[2]));
    })
    .toBeLessThan(1.5);
}

async function openLens(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
}

test('the ruler reports the pixel size it actually draws', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openLens(page, 'Metric Ruler');
  await settled(page.locator('svg.ruler'));

  const detail = page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Level of detail', exact: true }) });

  const text = (await detail.textContent()) ?? '';
  const reported = Number(/at ([\d.]+) px per/.exec(text)?.[1]);
  expect(Number.isFinite(reported)).toBe(true);

  const drawn = await page.locator('svg.ruler rect').nth(1).boundingBox();
  expect(drawn).not.toBeNull();

  // The figure in the readout and the shape on the screen are the same size.
  expect(Math.abs(drawn!.width - reported)).toBeLessThan(1.5);
});

test('the same claim holds on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await openLens(page, 'Metric Ruler');
  await settled(page.locator('svg.ruler'));

  const detail = page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: 'Level of detail', exact: true }) });

  const text = (await detail.textContent()) ?? '';
  const reported = Number(/at ([\d.]+) px per/.exec(text)?.[1]);
  const drawn = await page.locator('svg.ruler rect').nth(1).boundingBox();

  expect(Math.abs(drawn!.width - reported)).toBeLessThan(1.5);
});

test('the ruler grid draws its majors where it says it does', async ({ page }) => {
  for (const width of [420, 800, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await openLens(page, 'Metric Ruler');
    await settled(page.locator('svg.ruler'));

    const grid = page
      .locator('table.readout tr')
      .filter({ has: page.getByRole('rowheader', { name: 'Grid step', exact: true }) });
    const reported = Number(/, (\d+) px apart/.exec((await grid.textContent()) ?? '')?.[1]);

    // docs/UI_SPEC.md asks for roughly 80–140 px between majors. That has to be
    // real pixels, or it is not a legibility target at all.
    expect(reported, `at viewport width ${width}`).toBeGreaterThan(60);
    expect(reported, `at viewport width ${width}`).toBeLessThan(190);

    // And the readout has to describe the drawing, not just itself: measure the
    // gap between adjacent major tick lines on the screen.
    const xs = await page
      .locator('svg.ruler line.major')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().x).sort((left, right) => left - right),
      );
    expect(xs.length, `at viewport width ${width}`).toBeGreaterThan(1);
    const gaps = xs.slice(1).map((x, index) => x - xs[index]!);
    for (const gap of gaps) {
      expect(Math.abs(gap - reported), `at viewport width ${width}`).toBeLessThan(1.5);
    }
  }
});

test('the comparator strip collapses by real pixels', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await openLens(page, 'Comparator');

  const strip = page
    .locator('section.panel')
    .filter({ has: page.getByRole('heading', { name: 'To scale' }) });
  await settled(strip.locator('svg'));

  const text = (await strip.textContent()) ?? '';
  const shown = Number(/Drawn to scale: ([\d,]+) shown/.exec(text)?.[1]?.replace(/,/g, ''));

  if (Number.isFinite(shown)) {
    // If it says it drew them individually, they must each be a real pixel wide.
    const first = await strip.locator('svg rect').nth(1).boundingBox();
    expect(first!.width).toBeGreaterThanOrEqual(1);
  } else {
    await expect(strip).toContainText(/below a pixel|too many to draw/);
  }
});

test('the atlas keeps its minimum marker spacing in real pixels', async ({ page }) => {
  for (const width of [420, 800, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await settled(page.locator('svg.atlas'));

    const centres = await page.locator('svg.atlas circle').evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect();
          return box.x + box.width / 2;
        })
        .sort((left, right) => left - right),
    );
    expect(centres.length, `at viewport width ${width}`).toBeGreaterThan(1);

    // src/features/atlas/atlas.ts declutters at a 10 px minimum. If that is a
    // viewBox-unit minimum rather than a screen one it is not a minimum at all.
    for (let index = 1; index < centres.length; index += 1) {
      const gap = centres[index]! - centres[index - 1]!;
      expect(gap, `at viewport width ${width}`).toBeGreaterThanOrEqual(9.5);
    }

    // Decluttering is a rendering decision, never a change to the answer: the
    // markers stand in for at least as many objects as are in view.
    const text = (await page.getByText(/objects in view, in \d+ markers/).textContent()) ?? '';
    const [, inView, markers] = /(\d+) of \d+ objects in view, in (\d+) markers/.exec(text) ?? [];
    expect(Number(markers), `at viewport width ${width}`).toBe(centres.length);
    expect(Number(inView), `at viewport width ${width}`).toBeGreaterThanOrEqual(centres.length);
  }
});
