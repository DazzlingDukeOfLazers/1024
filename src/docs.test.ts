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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG, requireLength } from './catalog/catalog';

const resolve = (path: string): URL => new URL(`../${path}`, import.meta.url);
const read = (path: string): string => readFileSync(resolve(path), 'utf8');

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

describe('the documentation points at files that exist', () => {
  // Every backticked token that looks like a path. A backlog entry naming a
  // module that has since been renamed still reads as current, and there is no
  // way to notice by eye across forty-odd open items.
  const PROSE = [
    'README.md',
    'TASKS.md',
    'CLAUDE.md',
    'docs/ARCHITECTURE.md',
    'docs/DATA_MODEL.md',
    'docs/NUMERICS.md',
    'docs/TEST_STRATEGY.md',
    'docs/UI_SPEC.md',
    'docs/IMPLEMENTATION_PLAN.md',
  ];

  // Bare filenames — `binary64.ts`, `spacetime.ts` — are shorthand for "the
  // module called that", so they are checked by basename anywhere in the tree.
  const BASENAMES = new Set(
    ['src', 'e2e', 'fixtures']
      .flatMap((dir) => readdirSync(resolve(dir), { recursive: true }) as string[])
      .map((entry) => entry.split(/[\\/]/).at(-1)!),
  );

  const referencesIn = (doc: string): string[] => [
    ...new Set(
      [...read(doc).matchAll(/`([\w./-]+\.(?:ts|tsx|json|css|yml))`/g)]
        .map((match) => match[1]!)
        .filter((path) => !path.startsWith('.github/')),
    ),
  ];

  for (const doc of PROSE) {
    it(`${doc} names no missing file`, () => {
      const missing = referencesIn(doc).filter(
        (path) => !existsSync(resolve(path)) && !BASENAMES.has(path),
      );
      expect(missing, `${doc} refers to files that are not there`).toEqual([]);
    });
  }

  it('is actually finding references rather than passing on an empty set', () => {
    // Nine distinct code files are named across the docs today. The floor is
    // well under that: this guard exists to catch the pattern silently matching
    // nothing, not to freeze how many files the prose happens to mention.
    const all = new Set(PROSE.flatMap(referencesIn));
    expect(all.size).toBeGreaterThan(4);
    expect([...all]).toContain('binary64.ts');
  });
});

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
