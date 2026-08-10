/**
 * The states the app can be put into.
 *
 * Shared rather than per-spec, because the lesson of the conformance work is
 * that a rule checked in the states someone happened to think of is a rule with
 * holes in exactly the shape of that person's attention. Any check worth making
 * is worth making everywhere, and everywhere has to be one list.
 */

import { type Page } from '@playwright/test';

export interface AppState {
  readonly name: string;
  readonly reach: (page: Page) => Promise<void>;
}

const lens = (name: string) => async (page: Page) => {
  await page.getByRole('navigation', { name: 'Lenses' }).getByRole('button', { name }).click();
};

export const STATES: AppState[] = [
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
  {
    // The densest semantic panel: the one object with four relations, and the
    // one whose neighbour list showed the same object twice.
    name: 'atlas/related',
    reach: async (page) => {
      await page.getByLabel('Object', { exact: true }).selectOption('skin-cell');
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

for (const operation of [
  'how-many-fit',
  'ratio',
  'difference',
  'end-to-end',
  'area-ratio',
  'volume-ratio',
] as const) {
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

for (const [a, b, name] of [
  ['2^700 + 2^12', '2^300 + 1', 'sparse'],
  ['2^1024 - 1', '2^1024 - 1', 'dense'],
  ['0', '5', 'zero'],
  ['not a number', '1', 'unreadable'],
] as const) {
  STATES.push({
    name: `architecture/${name}`,
    reach: async (page) => {
      await lens('Architecture Lab')(page);
      await page.getByLabel('A', { exact: true }).fill(a);
      await page.getByLabel('B', { exact: true }).fill(b);
    },
  });
}

for (const digitBits of ['8', '128'] as const) {
  STATES.push({
    name: `architecture/${digitBits}-bit-digits`,
    reach: async (page) => {
      await lens('Architecture Lab')(page);
      await page.getByLabel('Digit width').selectOption(digitBits);
    },
  });
}

// The division panel: the start, somewhere in the middle, and a divisor of zero,
// which has no quotient and no remainder and must say so rather than taking the
// lens down with it.
for (const [name, position, b] of [
  ['division-start', '0', '2^300 + 1'],
  ['division-midway', '300', '2^300 + 1'],
  ['division-by-zero', '0', '0'],
] as const) {
  STATES.push({
    name: `architecture/${name}`,
    reach: async (page) => {
      await lens('Architecture Lab')(page);
      await page.getByLabel('B', { exact: true }).fill(b);
      const slider = page.getByLabel('Quotient digit');
      if ((await slider.count()) > 0) await slider.fill(position);
    },
  });
}

// Every division algorithm, because the tape shades a cell by what the digit is
// worth and that path does nothing at all at radix 2 — every digit there is a
// zero or a one.
for (const algorithm of [
  'restoring-radix-4',
  'restoring-radix-8',
  'non-restoring-radix-2',
  'reciprocal-newton',
] as const) {
  STATES.push({
    name: `architecture/${algorithm}`,
    reach: async (page) => {
      await lens('Architecture Lab')(page);
      await page.getByLabel('Algorithm').selectOption(algorithm);
      // The reciprocal method has no digits to step through, so no slider.
      const slider = page.getByLabel('Quotient digit');
      if ((await slider.count()) > 0) await slider.fill('120');
    },
  });
}

// Mid-accumulation: the matrix highlight, the partially filled strip and the
// step narration all exist only between the endpoints, which no other state
// visits.
STATES.push({
  name: 'architecture/accumulation-midway',
  reach: async (page) => {
    await lens('Architecture Lab')(page);
    await page.getByLabel('Partial product', { exact: true }).fill('2');
  },
});

// The scenario selector governs the comparison panel as well as the narrowing
// readout, and `Trap on any inexact result` is the state where a row has no
// markers to draw and falls back to text. That is a first-run path, which is
// where every defect in this project has come from, so it gets swept.
for (const scenario of [
  'Preserve everything',
  'Trap on any inexact result',
  'Truncate and discard residue',
] as const) {
  STATES.push({
    name: `architecture/${scenario.split(' ')[0]!.toLowerCase()}`,
    reach: async (page) => {
      await lens('Architecture Lab')(page);
      await page.getByLabel('Scenario').selectOption({ label: scenario });
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
