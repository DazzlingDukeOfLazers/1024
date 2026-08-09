import { type Locator, expect, test } from '@playwright/test';
import { metresIn } from './parse';

/**
 * Both pannable views set `touch-action: none`, which takes the browser's own
 * pinch away. That is correct — the app owns the gesture — but only if the app
 * then implements it. Without pinch there is no way to zoom on a phone at all:
 * the wheel does not exist there and neither does the keyboard.
 */

test.use({ hasTouch: true, viewport: { width: 420, height: 900 } });

/**
 * A two-finger pinch, dispatched as pointer events because that is what the
 * views listen to and what a touchscreen produces.
 */
async function pinch(target: Locator, from: [number, number], to: [number, number]): Promise<void> {
  await target.evaluate(
    (element, { from, to }) => {
      const box = element.getBoundingClientRect();
      const at = (x: number) => box.left + x;
      const send = (type: string, id: number, x: number) => {
        element.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 1,
            clientX: at(x),
            clientY: box.top + box.height / 2,
            bubbles: true,
          }),
        );
      };

      send('pointerdown', 1, from[0]);
      send('pointerdown', 2, from[1]);
      // Several steps, because a pinch is a sequence of small ratios rather
      // than one jump, and that is what the handler has to accumulate.
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8;
        send('pointermove', 1, from[0] + (to[0] - from[0]) * t);
        send('pointermove', 2, from[1] + (to[1] - from[1]) * t);
      }
      send('pointerup', 1, to[0]);
      send('pointerup', 2, to[1]);
    },
    { from, to },
  );
}

const readout = (page: import('@playwright/test').Page, header: string) =>
  page
    .locator('table.readout tr')
    .filter({ has: page.getByRole('rowheader', { name: header, exact: true }) });

test('the ruler zooms in when you spread two fingers', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();

  const before = (await readout(page, 'Across the view').textContent()) ?? '';
  await pinch(page.locator('svg.ruler'), [140, 220], [40, 320]);
  const after = (await readout(page, 'Across the view').textContent()) ?? '';

  expect(after).not.toBe(before);
  // Spreading the fingers shows less of the world, not more.
  expect(metresIn(after)).toBeLessThan(metresIn(before));
});

test('the ruler zooms out when you pinch two fingers together', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();

  const before = (await readout(page, 'Across the view').textContent()) ?? '';
  await pinch(page.locator('svg.ruler'), [40, 320], [140, 220]);
  const after = (await readout(page, 'Across the view').textContent()) ?? '';

  expect(metresIn(after)).toBeGreaterThan(metresIn(before));
});

test('the atlas zooms on a pinch too', async ({ page }) => {
  await page.goto('/');

  const before = (await readout(page, 'Visible span').textContent()) ?? '';
  await pinch(page.locator('svg.atlas'), [140, 220], [20, 340]);
  const after = (await readout(page, 'Visible span').textContent()) ?? '';

  expect(after).not.toBe(before);
  const perDecade = (text: string) => Number(/([\d.]+) px per decade/.exec(text)?.[1]);
  expect(perDecade(after)).toBeGreaterThan(perDecade(before));
});

test('a pinch does not leave the view stuck in a drag', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Lenses' })
    .getByRole('button', { name: 'Metric Ruler' })
    .click();

  await pinch(page.locator('svg.ruler'), [140, 220], [40, 320]);
  const settled = (await readout(page, 'Centre').textContent()) ?? '';

  // Lifting both fingers ends the gesture: a pointer that is no longer down
  // must not keep steering the camera.
  await page.mouse.move(200, 400);
  await page.mouse.move(60, 400);
  expect((await readout(page, 'Centre').textContent()) ?? '').toBe(settled);
});
