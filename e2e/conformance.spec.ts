import { type Page, expect, test } from '@playwright/test';

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
 *  5. a value under a label claiming exactness carries the formatter's verdict.
 */

interface Finding {
  readonly rule: string;
  readonly detail: string;
}

/** One state of the app: how to get there, and what to call it. */
interface AppState {
  readonly name: string;
  readonly reach: (page: Page) => Promise<void>;
}

const lens = (name: string) => async (page: Page) => {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
};

const STATES: AppState[] = [
  { name: 'atlas', reach: async () => {} },
  {
    name: 'atlas/long-name',
    reach: async (page) => {
      await page.getByLabel('Object', { exact: true }).selectOption('city');
    },
  },
  {
    name: 'atlas/cited',
    reach: async (page) => {
      await page.getByLabel('Object', { exact: true }).selectOption('earth');
    },
  },
  {
    name: 'atlas/whole-range',
    reach: async (page) => {
      await page.getByRole('button', { name: 'Whole range' }).click();
    },
  },
];

for (const preset of ['rbc-across-mm', 'coconuts', 'far-origin', 'human-scale'] as const) {
  STATES.push({
    name: `ruler/${preset}`,
    reach: async (page) => {
      await lens('Metric Ruler')(page);
      await page.getByLabel('Preset').selectOption(preset);
    },
  });
}

for (const operation of ['how-many-fit', 'ratio', 'difference', 'end-to-end'] as const) {
  for (const [subject, label] of [
    ['object:red-blood-cell', 'object'],
    ['unit:km', 'unit'],
  ] as const) {
    STATES.push({
      name: `comparator/${operation}/${label}`,
      reach: async (page) => {
        await lens('Comparator')(page);
        await page.getByLabel('A', { exact: true }).selectOption(subject);
        await page.getByLabel('Operation').selectOption(operation);
      },
    });
  }
}

for (const [value, unit, name] of [
  ['1', 'm', 'power-of-two'],
  ['3', 'm', 'ordinary'],
  ['1e-310', 'm', 'subnormal'],
  ['1', 'Gm', 'large'],
  ['1', 'ly', 'astronomical'],
] as const) {
  STATES.push({
    name: `microscope/${name}`,
    reach: async (page) => {
      await lens('Numerical Microscope')(page);
      await page.getByLabel('Value', { exact: true }).fill(value);
      await page.getByLabel('Unit', { exact: true }).selectOption(unit);
    },
  });
}

for (const experiment of [
  'decimal-0-1-plus-0-2',
  'million-millimeters',
  'large-offset',
  'tenth-times-ten',
  'nearly-equal',
  'thirds',
] as const) {
  STATES.push({
    name: `lab/${experiment}`,
    reach: async (page) => {
      await lens('Representation Lab')(page);
      await page.getByLabel('Experiment').selectOption(experiment);
    },
  });
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

    return { findings, examined };
  });
}

/** Wait until every measured view has had its measurement. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('svg[viewBox]')).every((svg) => {
          const declared = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
          const drawn = svg.getBoundingClientRect().width;
          return drawn === 0 || Math.abs(declared - drawn) < 1.5;
        }),
      ),
    )
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
