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
