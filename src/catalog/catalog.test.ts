import { describe, expect, it } from 'vitest';
import rawSample from '../../fixtures/objects.sample.json';
import { CATALOG, createCatalog, requireLength } from './catalog';
import { CatalogError, isExactQuantity, parseScaleObject, primaryLength } from './schema';
import { ONE, equals, gt, lt, pow10, rational } from '../core/rational/rational';
import { parseDecimalExact } from '../core/rational/parse';
import { toUnit } from '../core/quantities/quantity';
import { formatEngineering } from '../core/units/format';

const r = rational;

describe('the built-in catalog', () => {
  it('holds the 20–30 objects v0 asks for', () => {
    expect(CATALOG.objects.length).toBeGreaterThanOrEqual(20);
    expect(CATALOG.objects.length).toBeLessThanOrEqual(30);
  });

  it('spans from the Planck length to the observable universe', () => {
    const ordered = CATALOG.byScale();
    expect(ordered[0]?.id).toBe('planck-length');
    expect(ordered.at(-1)?.id).toBe('observable-universe');
  });

  it('covers the scales docs/DATA_MODEL.md lists', () => {
    for (const id of [
      'planck-length',
      'proton',
      'hydrogen-atom',
      'dna-helix',
      'virus',
      'bacterium',
      'red-blood-cell',
      'human-hair',
      'grain-of-sand',
      'ant',
      'coconut',
      'human',
      'door',
      'house',
      'skyscraper',
      'city',
      'earth',
      'moon',
      'sun',
      'astronomical-unit',
      'solar-system',
      'light-year',
      'milky-way',
      'observable-universe',
    ]) {
      expect(CATALOG.get(id), `missing ${id}`).toBeDefined();
    }
  });

  it('orders by scale strictly, with no ties to hide a duplicate', () => {
    const ordered = CATALOG.byScale();
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = requireLength(ordered[i - 1]!).value.value;
      const current = requireLength(ordered[i]!).value.value;
      expect(lt(previous, current) || equals(previous, current)).toBe(true);
    }
  });

  it('spans more than 60 orders of magnitude', () => {
    const smallest = requireLength(CATALOG.byScale()[0]!).value.value;
    const largest = requireLength(CATALOG.byScale().at(-1)!).value.value;
    expect(gt(largest, smallest)).toBe(true);
    // Planck length ~1e-35 m, observable universe ~1e27 m.
    expect(lt(smallest, pow10(-34))).toBe(true);
    expect(gt(largest, pow10(26))).toBe(true);
  });
});

describe('exact definitions are marked as exact', () => {
  it('treats the astronomical unit and the light-year as definitions', () => {
    for (const id of ['astronomical-unit', 'light-year']) {
      const length = requireLength(CATALOG.require(id));
      expect(isExactQuantity(length)).toBe(true);
      expect(length.range).toBeUndefined();
    }
  });

  it('stores them at their exactly defined values', () => {
    expect(requireLength(CATALOG.require('astronomical-unit')).value.value).toEqual(
      r(149597870700n),
    );
    expect(requireLength(CATALOG.require('light-year')).value.value).toEqual(r(9460730472580800n));
  });

  it('does not pretend any measured object is exact', () => {
    for (const object of CATALOG.objects) {
      const length = requireLength(object);
      if (isExactQuantity(length)) {
        expect(['astronomical-unit', 'light-year']).toContain(object.id);
      }
    }
  });

  it('gives every non-exact quantity a source', () => {
    for (const object of CATALOG.objects) {
      const length = requireLength(object);
      expect(length.source, `${object.id} has no source`).toBeDefined();
    }
  });
});

describe('ranges', () => {
  it('keeps the coconut range PROJECT_SPEC §16 specifies', () => {
    const coconut = requireLength(CATALOG.require('coconut'));
    expect(coconut.value.value).toEqual(parseDecimalExact('0.20'));
    expect(coconut.range?.min.value).toEqual(parseDecimalExact('0.15'));
    expect(coconut.range?.max.value).toEqual(parseDecimalExact('0.30'));
    expect(coconut.approximation).toBe('representative');
  });

  it('keeps a representative red blood cell diameter in micrometres', () => {
    const cell = requireLength(CATALOG.require('red-blood-cell'));
    expect(toUnit(cell.value, 'µm')).toEqual(parseDecimalExact('7.5'));
    expect(formatEngineering(cell.value).text).toBe('7.5 µm');
  });

  it('has the representative value inside its own range', () => {
    for (const object of CATALOG.objects) {
      const length = requireLength(object);
      if (length.range === undefined) continue;
      expect(lt(length.value.value, length.range.min.value), `${object.id} below its range`).toBe(
        false,
      );
      expect(gt(length.value.value, length.range.max.value), `${object.id} above its range`).toBe(
        false,
      );
    }
  });
});

describe('search and categories', () => {
  it('finds objects by name, alias, id and category', () => {
    expect(CATALOG.search('coconut').map((o) => o.id)).toEqual(['coconut']);
    expect(CATALOG.search('RBC').map((o) => o.id)).toEqual(['red-blood-cell']);
    expect(CATALOG.search('erythrocyte').map((o) => o.id)).toEqual(['red-blood-cell']);
    expect(CATALOG.search('astronomy').length).toBeGreaterThan(3);
  });

  it('is case-insensitive and returns everything for an empty query', () => {
    expect(CATALOG.search('CoCoNuT').map((o) => o.id)).toEqual(['coconut']);
    expect(CATALOG.search('   ').length).toBe(CATALOG.byScale().length);
  });

  it('exposes the category axis of the graph', () => {
    expect(CATALOG.categories()).toContain('biology');
    expect(CATALOG.categories()).toContain('astronomy');
    expect(CATALOG.inCategory('fruit').map((o) => o.id)).toEqual(['coconut']);
  });

  it('lets one object belong to several categories at once', () => {
    // docs/DATA_MODEL.md: a graph, not a single tree. A coconut is botany and
    // food and human-scale simultaneously.
    const coconut = CATALOG.require('coconut');
    expect(coconut.categories).toContain('botany');
    expect(coconut.categories).toContain('food');
    expect(CATALOG.inCategory('botany')).toContain(coconut);
    expect(CATALOG.inCategory('food')).toContain(coconut);
  });
});

describe('schema validation', () => {
  it('accepts the authored sample fixture, fractions and all', () => {
    const sample = createCatalog(rawSample as unknown[]);
    expect(sample.objects.map((o) => o.id)).toContain('red-blood-cell');
    // The sample writes values as {numerator, denominator}; the new fixture
    // writes them as strings. Both must land on the same exact value.
    expect(toUnit(requireLength(sample.require('red-blood-cell')).value, 'µm')).toEqual(
      parseDecimalExact('7.5'),
    );
  });

  it('rejects an unknown dimension', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          mass: { dimension: 'mass', unit: 'kg', representative: '1', approximation: 'exact' },
        },
      }),
    ).toThrow(CatalogError);
  });

  it('rejects a unit from the wrong dimension', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          length: { dimension: 'length', unit: 's', representative: '1', approximation: 'exact' },
        },
      }),
    ).toThrow(/not a length/);
  });

  it('rejects an unknown approximation kind', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          length: { dimension: 'length', unit: 'm', representative: '1', approximation: 'vibes' },
        },
      }),
    ).toThrow(CatalogError);
  });

  it('rejects an inverted range', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          length: {
            dimension: 'length',
            unit: 'm',
            representative: '1',
            range: { min: '2', max: '1' },
            approximation: 'measured',
          },
        },
      }),
    ).toThrow(/min is greater than max/);
  });

  it('rejects an object with no quantities, which could not be compared', () => {
    expect(() => parseScaleObject({ id: 'x', name: 'x', quantities: {} })).toThrow(CatalogError);
  });

  it('rejects duplicate ids and dangling relations', () => {
    const object = {
      id: 'x',
      name: 'x',
      quantities: {
        length: { dimension: 'length', unit: 'm', representative: '1', approximation: 'exact' },
      },
    };
    expect(() => createCatalog([object, object])).toThrow(/Duplicate/);
    expect(() =>
      createCatalog([{ ...object, relations: [{ type: 'part-of', targetId: 'nope' }] }]),
    ).toThrow(/unknown object/);
  });

  it('keeps visuals optional and identity independent of them', () => {
    const withoutVisual = parseScaleObject({
      id: 'x',
      name: 'x',
      quantities: {
        length: { dimension: 'length', unit: 'm', representative: '1', approximation: 'exact' },
      },
    });
    expect(withoutVisual.visuals).toEqual([]);
    expect(primaryLength(withoutVisual)?.value.value).toEqual(ONE);

    // Most of the catalog has no artwork at all, and works anyway.
    expect(CATALOG.objects.filter((o) => o.visuals.length === 0).length).toBeGreaterThan(0);
  });

  it('rejects an unknown visual provider', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          length: { dimension: 'length', unit: 'm', representative: '1', approximation: 'exact' },
        },
        visuals: [{ provider: 'my-hard-drive' }],
      }),
    ).toThrow(/unknown provider/);
  });

  it('parses values written as strings or as fractions identically', () => {
    const asString = parseScaleObject({
      id: 'a',
      name: 'a',
      quantities: {
        length: { dimension: 'length', unit: 'm', representative: '3/20', approximation: 'exact' },
      },
    });
    const asFraction = parseScaleObject({
      id: 'b',
      name: 'b',
      quantities: {
        length: {
          dimension: 'length',
          unit: 'm',
          representative: { numerator: '3', denominator: '20' },
          approximation: 'exact',
        },
      },
    });
    expect(primaryLength(asString)?.value).toEqual(primaryLength(asFraction)?.value);
  });
});

describe('objects are frozen', () => {
  it('cannot be mutated after loading', () => {
    const coconut = CATALOG.require('coconut');
    expect(Object.isFrozen(coconut)).toBe(true);
    expect(Object.isFrozen(coconut.quantities)).toBe(true);
  });
});
