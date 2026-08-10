import { type Page, expect, test } from '@playwright/test';
import { STATES } from './states';

/**
 * Every invariant, in every state the app can be put into.
 *
 * The last several defects all arrived the same way: a path nobody had walked,
 * and — twice — a fix that was right where I was looking and missing one panel
 * over. Both halves of that are addressable, and neither is addressable by
 * looking harder.
 *
 * So: enumerate the states rather than visiting the ones that come to mind, and
 * write the checks so they scan the whole document rather than one panel. A rule
 * satisfied in the Comparator and dropped in the Lab has to fail here, or this
 * file is just more of the same.
 *
 * These are the rules earned one at a time by the commits before this one:
 *
 *  1. no two labels overlap;
 *  2. no label is cut off by the edge of its own drawing;
 *  3. no label is too small to read;
 *  4. the page never scrolls sideways;
 *  5. a value under a label claiming exactness carries the formatter's verdict;
 *  6. the lens drew at all.
 *
 * Rule 6 is the one that closes this file's own vacuity. Rules 1–5 are all
 * statements about drawn things, so a lens that fell back to its error boundary
 * satisfies every one of them by drawing nothing — and that is not hypothetical:
 * selecting `Trap on any inexact result`, a scenario the Architecture Lab's own
 * menu offers, replaced the entire lens with an apology, and adding that state
 * to the sweep did not fail the sweep. A rule set that cannot tell "nothing is
 * wrong" from "nothing is there" is the same blind spot this file was written
 * against, one level up.
 */

interface Finding {
  readonly rule: string;
  readonly detail: string;
}

/**
 * All five rules, evaluated in the page against what was actually drawn.
 *
 * Returns findings rather than asserting, so one state reports everything wrong
 * with it instead of stopping at the first thing.
 */
async function inspect(page: Page): Promise<{ findings: Finding[]; examined: number }> {
  return page.evaluate(() => {
    const findings: { rule: string; detail: string }[] = [];
    let examined = 0;

    /* 1–3: what the SVGs drew. */
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const frame = svg.getBoundingClientRect();
      const labels = Array.from(svg.querySelectorAll('text'))
        .map((node) => ({ box: node.getBoundingClientRect(), text: node.textContent ?? '' }))
        .filter((entry) => entry.text.trim() !== '' && entry.box.width > 0);
      examined += labels.length;

      for (const label of labels) {
        if (label.box.height < 7) {
          findings.push({ rule: 'too small', detail: `"${label.text}" at ${label.box.height}px` });
        }
        if (label.box.left < frame.left - 1 || label.box.right > frame.right + 1) {
          findings.push({ rule: 'off the edge', detail: `"${label.text}"` });
        }
        // Vertical too. This was missing, and a caption placed fourteen pixels
        // below its own viewBox was clipped in half while the sweep reported
        // the state clean — a rule that checks one axis of a two-axis problem.
        if (label.box.top < frame.top - 1 || label.box.bottom > frame.bottom + 1) {
          findings.push({ rule: 'clipped vertically', detail: `"${label.text}"` });
        }
      }

      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          const a = labels[i]!;
          const b = labels[j]!;
          const sameLine =
            Math.abs(a.box.top - b.box.top) < Math.min(a.box.height, b.box.height) / 2;
          const across = a.box.left < b.box.right - 1 && b.box.left < a.box.right - 1;
          if (sameLine && across) {
            findings.push({ rule: 'overlap', detail: `"${a.text}" over "${b.text}"` });
          }
        }
      }
    }

    /* 4: the document itself. */
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      findings.push({
        rule: 'page scrolls sideways',
        detail: `${root.scrollWidth} > ${root.clientWidth}`,
      });
    }

    /* 5: anything under a label claiming exactness carries the verdict. */
    const claimsExact = (text: string) => /\bexact\b/i.test(text);
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const headerCells = Array.from(table.querySelectorAll('thead th'));
      const exactColumns = headerCells
        .map((cell, index) => ({ index, claims: claimsExact(cell.textContent ?? '') }))
        .filter((entry) => entry.claims)
        .map((entry) => entry.index);

      for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
        const cells = Array.from(row.children);

        // Row headers: "Exact value", "Exact reference", "Exact rational".
        const rowHeader = row.querySelector('th[scope="row"]');
        if (rowHeader !== null && claimsExact(rowHeader.textContent ?? '')) {
          const value = cells[1];
          examined += 1;
          if (value !== undefined && value.querySelector('[data-exact]') === null) {
            findings.push({
              rule: 'unverified exactness',
              detail: `"${rowHeader.textContent}" -> "${value.textContent}"`,
            });
          }
        }

        // Column headers: the timeline's "Exact" column.
        for (const column of exactColumns) {
          const value = cells[column];
          if (value === undefined || value.tagName === 'TH') continue;
          examined += 1;
          if (value.querySelector('[data-exact]') === null) {
            findings.push({
              rule: 'unverified exactness',
              detail: `column ${column} -> "${value.textContent}"`,
            });
          }
        }
      }
    }

    /* 6: the lens drew at all. */
    for (const failed of Array.from(document.querySelectorAll('[data-lens-failed]'))) {
      findings.push({
        rule: 'lens did not draw',
        detail: failed.querySelector('.error')?.textContent ?? '',
      });
    }

    return { findings, examined };
  });
}

/**
 * Wait until every measured view has had its measurement, and has stopped
 * changing.
 *
 * Matching once is not enough. A view is measured by a `ResizeObserver`, so a
 * state change is: render at the old width, observe, render again. Sampling
 * between those can catch geometry that is consistent with itself and about to
 * be replaced, and the sweep would then report an overlap that exists for one
 * frame. Requiring two consecutive agreeing samples across an animation frame
 * removes that without weakening anything: a real overlap is still an overlap on
 * the second look.
 *
 * This was added after one failure in roughly six full runs that could not be
 * reproduced in twelve subsequent attempts, and whose diagnostic the passing
 * rerun had already deleted. It is the most plausible cause rather than a
 * diagnosed one, and is recorded that way in TASKS.
 */
async function settled(page: Page): Promise<void> {
  const measure = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          requestAnimationFrame(() => {
            resolve(
              Array.from(document.querySelectorAll('svg[viewBox]'))
                .map((svg) => {
                  const declared = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
                  const drawn = svg.getBoundingClientRect().width;
                  const settledHere = drawn === 0 || Math.abs(declared - drawn) < 1.5;
                  return `${settledHere ? 'ok' : 'no'}:${Math.round(drawn)}`;
                })
                .join('|'),
            );
          });
        }),
    );

  await expect
    .poll(async () => {
      const first = await measure();
      if (first.includes('no:')) return false;
      return first === (await measure());
    })
    .toBe(true);
}

for (const width of [420, 1280]) {
  test(`every state holds every rule at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const problems: string[] = [];
    let examinedTotal = 0;

    for (const state of STATES) {
      await page.goto('/');
      await state.reach(page);
      await settled(page);

      const { findings, examined } = await inspect(page);
      examinedTotal += examined;
      for (const finding of findings) {
        problems.push(`${state.name} [${finding.rule}] ${finding.detail}`);
      }
    }

    // The substance first, so a run that is failing for two reasons still shows
    // the interesting one.
    expect(problems, problems.join('\n')).toEqual([]);

    // Then the evidence that it looked: a sweep which examined nothing would
    // also report nothing wrong. The floor is well under the real figures — 196
    // at 420 px and 319 at 1280, the difference being the decluttering doing its
    // job — because it exists to catch a broken sweep, not to pin a count.
    expect(STATES.length, 'states enumerated').toBeGreaterThan(20);
    expect(examinedTotal, 'labels and cells examined').toBeGreaterThan(100);
  });
}
