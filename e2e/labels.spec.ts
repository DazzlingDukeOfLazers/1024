import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * Labels are claims too, and a claim nobody can read is one that failed.
 *
 * Both views declutter their marks and neither decluttered its words: the Atlas
 * drew "Virus (representative)Human +1" as one run of characters and stacked
 * "10^-45 m10^-42 m" along its axis, and the Ruler drew its unit symbol through
 * the last tick label so a 420 px screen read "µ200".
 *
 * The layout code estimates text width, because it is DOM-free by design and
 * `getComputedTextLength` needs a live SVG. These tests are what keep the
 * estimate honest: they measure what the browser actually drew.
 */

interface Box {
  x: number;
  width: number;
  y: number;
  height: number;
  text: string;
}

async function textBoxes(root: Locator): Promise<Box[]> {
  return root.locator('text').evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          width: box.width,
          y: box.y,
          height: box.height,
          text: node.textContent ?? '',
        };
      })
      .filter((box) => box.width > 0 && box.text.trim() !== ''),
  );
}

/** Two boxes that share a line and overlap horizontally are unreadable. */
function overlaps(boxes: readonly Box[]): string[] {
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const sameLine = Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2;
      // A one-pixel graze is antialiasing, not a collision.
      const horizontal = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1;
      if (sameLine && horizontal) clashes.push(`"${a.text}" over "${b.text}"`);
    }
  }
  return clashes;
}

const openLens = async (page: Page, name: string) => {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
};

for (const width of [420, 800, 1280, 1600]) {
  test(`no atlas label overlaps another at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const atlas = page.locator('svg.atlas');
    await expect(atlas).toBeVisible();
    // Give the ResizeObserver its measurement before reading geometry.
    await expect
      .poll(async () => {
        const box = await atlas.boundingBox();
        const viewBox = await atlas.getAttribute('viewBox');
        return Math.abs((box?.width ?? 0) - Number(viewBox?.split(' ')[2]));
      })
      .toBeLessThan(1.5);

    const boxes = await textBoxes(atlas);
    expect(overlaps(boxes), `at ${width}px`).toEqual([]);

    // Nor may a label run off the edge, where it is cut in half rather than read.
    const view = (await atlas.boundingBox())!;
    for (const box of boxes) {
      expect(box.x, `"${box.text}" starts left of the view at ${width}px`).toBeGreaterThanOrEqual(
        view.x - 1,
      );
      expect(
        box.x + box.width,
        `"${box.text}" runs past the view at ${width}px`,
      ).toBeLessThanOrEqual(view.x + view.width + 1);
    }
  });

  test(`no ruler label overlaps another at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await openLens(page, 'Metric Ruler');
    const ruler = page.locator('svg.ruler');
    await expect(ruler).toBeVisible();
    await expect
      .poll(async () => {
        const box = await ruler.boundingBox();
        const viewBox = await ruler.getAttribute('viewBox');
        return Math.abs((box?.width ?? 0) - Number(viewBox?.split(' ')[2]));
      })
      .toBeLessThan(1.5);

    expect(overlaps(await textBoxes(ruler)), `at ${width}px`).toEqual([]);
  });
}

test('the atlas keeps labelling its axis even when it drops some labels', async ({ page }) => {
  // Dropping every label would satisfy "nothing overlaps" and be useless, so
  // the axis has to still say what it is.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const labels = await textBoxes(page.locator('svg.atlas'));
  expect(labels.filter((box) => /^10\^|m$/.test(box.text)).length).toBeGreaterThan(4);
});

test('every control stays inside its panel on a narrow screen', async ({ page }) => {
  // The Atlas has four controls in one row. Without wrapping, "Open in Ruler"
  // sat off the right edge of a 420 px screen where it could not be reached.
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');

  const panel = await page.locator('section.panel').first().boundingBox();
  for (const name of ['Whole range', 'Centre on selection', 'Open in Ruler']) {
    const button = await page.getByRole('button', { name }).boundingBox();
    expect(button, name).not.toBeNull();
    expect(button!.x + button!.width, `${name} runs past the panel`).toBeLessThanOrEqual(
      panel!.x + panel!.width + 1,
    );
  }
});
