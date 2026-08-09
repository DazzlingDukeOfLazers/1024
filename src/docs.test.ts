/**
 * The documentation states counts. Counts rot.
 *
 * `24 catalog objects` sat in the README and in two places in TASKS.md for
 * several commits after the catalog grew to 28, and nothing failed. For a
 * project whose subject is numbers that do not lie, a stale number in the front
 * door is worth a test rather than a proofread.
 *
 * These check only the claims a machine can settle. Prose still needs reading.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG, requireLength } from './catalog/catalog';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const NUMBER_WORDS: Record<number, string> = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  7: 'Seven',
  8: 'Eight',
  9: 'Nine',
  10: 'Ten',
};

const cited = CATALOG.objects.filter((object) => requireLength(object).source !== undefined);

describe('the README counts what is actually there', () => {
  const readme = read('README.md');

  it('states the catalog size correctly', () => {
    const stated = Number(/The (\d+) catalog objects/.exec(readme)?.[1]);
    expect(stated).toBe(CATALOG.objects.length);
  });

  it('states how many objects are cited correctly', () => {
    const word = NUMBER_WORDS[cited.length];
    expect(word, `no word for ${cited.length}`).toBeDefined();
    expect(readme).toContain(`${word} are cited`);
  });

  it('states how many are not', () => {
    const stated = Number(/The other (\d+) are/.exec(readme)?.[1]);
    expect(stated).toBe(CATALOG.objects.length - cited.length);
  });
});

describe('docs/DATA_MODEL.md counts what is actually there', () => {
  const dataModel = read('docs/DATA_MODEL.md');

  it('states the fixture size correctly', () => {
    const stated = Number(/`fixtures\/objects\.json` holds (\d+) objects/.exec(dataModel)?.[1]);
    expect(stated).toBe(CATALOG.objects.length);
  });

  it('lists exactly the cited objects in its citation table', () => {
    // The table sits between "are backed by a citation:" and the paragraph after
    // it. Its data rows are the ones that are not the header or the separator.
    const table = /are backed by a citation:\n\n([\s\S]*?)\n\n/.exec(dataModel)?.[1] ?? '';
    const rows = table
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .filter((line) => !/^\|\s*-+/.test(line))
      .slice(1);

    expect(rows.length, 'citation table rows').toBe(cited.length);

    // Every row's claim column has to be a kind that requires a citation, or the
    // table is listing something the schema would not have made it cite.
    for (const row of rows) {
      const claim = row.split('|')[2]?.trim();
      expect(['exact', 'measured', 'representative'], row).toContain(claim);
    }
  });

  it('states how many objects remain unsourced', () => {
    const stated = Number(/The remaining (\d+) are `representative`/.exec(dataModel)?.[1]);
    expect(stated).toBe(CATALOG.objects.length - cited.length);
  });
});
