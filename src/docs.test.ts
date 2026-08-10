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
import { compare as compareQuantities } from './core/quantities/quantity';

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
  11: 'Eleven',
  12: 'Twelve',
  13: 'Thirteen',
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
    'docs/WIDE_INTEGER_ARCHITECTURE.md',
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

describe('the backlog does not contradict itself', () => {
  /**
   * The one class of backlog rot a machine can settle.
   *
   * Auditing every open item's premise against the code is a reading job and
   * stays one — it has now found eleven false entries across two passes. But
   * one of those eleven was findable mechanically: `The visualization of full
   * result / destination / residue from §8` sat in a single block twice, once
   * open and once done, describing the same work. An item cannot be both.
   *
   * Matched on the first eight words rather than the whole line, because the
   * two copies of that entry ended differently — "…§8. The arithmetic is done"
   * against "…§8, plus §22's wide-number chunks". Measured before choosing the
   * number: across 290 items it produces two same-state pairs and no
   * mixed-state ones, so it is not a filter that fires on everything.
   */
  const items = [...read('TASKS.md').matchAll(/^- \[( |x)\] (.+)$/gm)].map((match) => ({
    done: match[1] === 'x',
    opening: (match[2]!.toLowerCase().match(/[a-z0-9^]+/g) ?? []).slice(0, 8).join(' '),
  }));

  it('never lists the same item as both open and done', () => {
    const states = new Map<string, Set<boolean>>();
    for (const item of items) {
      const seen = states.get(item.opening) ?? new Set<boolean>();
      seen.add(item.done);
      states.set(item.opening, seen);
    }
    const contradictory = [...states.entries()]
      .filter(([, seen]) => seen.size > 1)
      .map(([opening]) => opening);
    expect(contradictory, 'listed as both open and done').toEqual([]);
  });

  it('is actually reading the backlog rather than matching nothing', () => {
    // A regex that stopped matching would report a contradiction-free file.
    expect(items.length).toBeGreaterThan(200);
    expect(items.some((item) => item.done)).toBe(true);
    expect(items.some((item) => !item.done)).toBe(true);
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

  it('states how many relations the fixture authors, and how they point', () => {
    // Both numbers, because the direction claim is the one that would quietly
    // become a folk memory of the fixture rather than a fact about it.
    const authored = CATALOG.objects.flatMap((object) => object.relations.map(() => object));
    const smallerFirst = CATALOG.objects.flatMap((object) =>
      object.relations.filter(
        (relation) =>
          compareQuantities(
            requireLength(object).value,
            requireLength(CATALOG.require(relation.targetId)).value,
          ) < 0,
      ),
    );

    const stated = /authors (\d+) relations, of which (\d+) point from the smaller/.exec(dataModel);
    expect(Number(stated?.[1])).toBe(authored.length);
    expect(Number(stated?.[2])).toBe(smallerFirst.length);
  });

  it('states how many objects remain unsourced', () => {
    const stated = Number(/The remaining (\d+) are `representative`/.exec(dataModel)?.[1]);
    expect(stated).toBe(CATALOG.objects.length - cited.length);
  });
});
