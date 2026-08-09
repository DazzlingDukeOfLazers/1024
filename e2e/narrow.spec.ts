import { type Page, expect, test } from '@playwright/test';

/**
 * What the app looks like on a phone.
 *
 * The measured-width work made the Ruler, the Atlas and the comparison strip
 * honest about pixels and left the Microscope's lattices and its resolution
 * chart on a fixed 760-unit viewBox. Scaled into 340 px that draws 10 px text at
 * about four and a half, which is not a small label but an unreadable one.
 *
 * Two separate failures, so two separate tests: text too small to read, and a
 * page that scrolls sideways because something inside it is wider than the
 * screen.
 */

const LENSES = [
  'Scale Atlas',
  'Metric Ruler',
  'Comparator',
  'Numerical Microscope',
  'Representation Lab',
];

const openLens = async (page: Page, name: string) => {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
  // Let the ResizeObserver deliver a measurement before anything is read.
  await page.waitForTimeout(150);
};

for (const width of [360, 420]) {
  test(`nothing pushes the page sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');

    for (const lens of LENSES) {
      await openLens(page, lens);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            className: typeof node.className === 'string' ? node.className : '',
            right: node.getBoundingClientRect().right,
          }))
          .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
          .slice(0, 5),
      }));

      expect(
        overflow.scrollWidth,
        `${lens} at ${width}px is wider than the screen: ${JSON.stringify(overflow.widest)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
}

test('no label is drawn too small to read on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');

  for (const lens of LENSES) {
    await openLens(page, lens);
    // The rendered height of an SVG text node, after the viewBox scaling that a
    // fixed viewBox applies to everything inside it.
    const drawn = await page.locator('svg text').evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          text: node.textContent ?? '',
          height: node.getBoundingClientRect().height,
        }))
        .filter((entry) => entry.text.trim() !== '' && entry.height > 0),
    );
    // The Comparator draws two labels and nothing else; every other lens draws
    // many. Zero would mean this test found nothing to look at, which is the way
    // an assertion about absent things passes without trying.
    expect(drawn.length, `${lens} drew no SVG text to measure`).toBeGreaterThan(1);
    expect(
      drawn.filter((entry) => entry.height < 7),
      `${lens} draws text below 7px`,
    ).toEqual([]);
  }
});
