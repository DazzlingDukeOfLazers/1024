import { test } from '@playwright/test';
import { STATES } from './states';

/**
 * Screenshots of every enumerated state, for unattended review.
 *
 * The in-app browser pane cannot be trusted for this — when it is not being
 * displayed nothing composites, ResizeObserver never fires, and every
 * self-measuring view sits at its fallback width. Headless Playwright
 * composites properly, so a session working alone looks at the app by running
 * this and reading the PNGs.
 *
 * Off unless asked for, so the ordinary suite stays fast:
 *
 *     $env:SHOTS='all';   npx playwright test e2e/screenshots   # everything
 *     $env:SHOTS='ruler'; npx playwright test e2e/screenshots   # name filter
 *
 * Output lands in shots/, which is gitignored.
 */
const filter = process.env['SHOTS'];

if (filter !== undefined && filter !== '') {
  for (const width of [1280, 420]) {
    for (const state of STATES) {
      if (filter !== 'all' && !state.name.includes(filter)) continue;
      test(`shot: ${state.name} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await state.reach(page);
        // Two frames so ResizeObserver-driven remeasures land before the shot.
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await page.screenshot({
          path: `shots/${state.name.replace(/\//g, '--')}-${width}.png`,
          fullPage: true,
        });
      });
    }
  }
}
