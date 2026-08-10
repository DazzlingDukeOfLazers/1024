import { expect, test } from '@playwright/test';
import { STATES } from './states';

/**
 * Visual regression, deliberately late and deliberately narrow.
 *
 * `docs/TEST_STRATEGY.md` said not to lock snapshots too early, and TASKS gave
 * the concrete reason it stayed deferred: the views were switched to measuring
 * their own width, and then the Architecture Lab grew four panels and two
 * animations. Baselines taken during that would have been re-recorded every
 * session, which teaches everyone to run `--update-snapshots` without looking —
 * the failure mode that makes a visual suite worse than none.
 *
 * The shape is settled now, so this locks a curated ten states rather than the
 * full sweep. The geometry rules in `conformance.spec.ts` already catch
 * overlap, clipping and off-edge labels everywhere; what pixels add is the
 * *unintended* change — a panel that moved because something else grew. Ten
 * states at two widths catch that without a hundred PNGs churning on every
 * tweak.
 *
 * These baselines are rendered on Windows and are not portable: fonts differ
 * on Linux, so every glyph moves and every one of these fails on CI for a
 * reason that has nothing to do with the change under test. The suite is
 * skipped there rather than pretending, and CI keeps the geometry rules, which
 * are portable because they assert relationships rather than pixels.
 *
 * To update after an intended visual change:
 *
 *     npx playwright test e2e/visual --update-snapshots
 *
 * and then *read the diff images* in `test-results/` before committing. A
 * baseline updated without looking is a test deleted without saying so.
 */

/** The states worth pixels: one per lens, plus the dense architecture views. */
const CURATED = [
  'atlas',
  'atlas/whole-range',
  'ruler/rbc-across-mm',
  'ruler/far-origin',
  'comparator/how-many-fit/object',
  'microscope/subnormal',
  'lab/thirds',
  'architecture/sparse',
  'architecture/dense',
  'architecture/accumulation-midway',
];

test.describe('the app still looks like itself', () => {
  test.skip(
    process.env['CI'] !== undefined,
    'baselines are Windows-rendered; CI keeps the portable geometry rules instead',
  );

  // A curated list is a hand-maintained list, and hand-maintained lists rot:
  // renaming a state in states.ts would silently drop it from the baseline set
  // and nothing would fail. So the names are checked against the enumeration.
  test('every curated name is a real state', () => {
    const known = new Set(STATES.map((state) => state.name));
    for (const name of CURATED) {
      expect(known, `curated state "${name}" no longer exists`).toContain(name);
    }
  });

  for (const width of [1280, 420]) {
    for (const name of CURATED) {
      test(`${name} at ${width}`, async ({ page }) => {
        const state = STATES.find((candidate) => candidate.name === name)!;
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await state.reach(page);
        // Animations are paused at rest in every one of these states, but a
        // measured view still re-renders once after its ResizeObserver fires;
        // two frames is the same settling the conformance sweep waits for.
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await expect(page).toHaveScreenshot(`${name.replace(/\//g, '--')}-${width}.png`, {
          fullPage: true,
          // Sub-pixel text rendering varies run to run by a hair; a hard zero
          // would make this suite flake and train people to ignore it.
          maxDiffPixelRatio: 0.002,
        });
      });
    }
  }
});
