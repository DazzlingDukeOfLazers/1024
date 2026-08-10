import { describe, expect, it } from 'vitest';
import rawSample from '../../fixtures/objects.sample.json';
import { CATALOG, createCatalog, requireLength } from './catalog';
import {
  CatalogError,
  allLengths,
  isExactQuantity,
  parseScaleObject,
  primaryLength,
  provenanceSummary,
} from './schema';
import { ONE, equals, gt, lt, mul, pow10, rational } from '../core/rational/rational';
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

  it('cites every quantity that claims to be exact or measured', () => {
    for (const object of CATALOG.objects) {
      const length = requireLength(object);
      if (length.approximation === 'exact' || length.approximation === 'measured') {
        expect(length.source, `${object.id} claims to be ${length.approximation}`).toBeDefined();
      }
    }
  });

  it('never dresses a provenance status up as a source', () => {
    for (const object of CATALOG.objects) {
      const source = requireLength(object).source;
      if (source === undefined) continue;
      // The fixtures used to carry `source: "demonstration value"`, which reads
      // like a citation everywhere it is displayed and is not one.
      expect(source.toLowerCase(), object.id).not.toMatch(
        /^(demonstration|placeholder|tbd|unknown|n\/a)/,
      );
    }
  });

  it('does not call an exact definition a plausible round number', () => {
    // A comparator subject built from a unit literal is exact and carries no
    // source, because a millimetre is a definition rather than a citation. The
    // uncited caveat would be false about it.
    expect(provenanceSummary({ approximation: 'exact' })).toBe('Exactly defined.');
    expect(provenanceSummary({ approximation: 'representative' })).toContain('No source recorded');
    expect(provenanceSummary({ approximation: 'estimated' })).toContain('No source recorded');
  });

  it('says what backs a number whether or not it is cited', () => {
    // Both branches have to produce a sentence, or a view that renders it will
    // silently say nothing for exactly the values that need the caveat most.
    expect(provenanceSummary(requireLength(CATALOG.require('earth')))).toMatch(
      /^Measured\. WGS 84/,
    );
    expect(provenanceSummary(requireLength(CATALOG.require('red-blood-cell')))).toMatch(
      /^A representative figure\. No source recorded/,
    );
    expect(provenanceSummary(requireLength(CATALOG.require('astronomical-unit')))).toMatch(
      /^Exactly defined\. IAU 2012/,
    );
    for (const object of CATALOG.objects) {
      expect(provenanceSummary(requireLength(object)).length, object.id).toBeGreaterThan(10);
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
          mass: {
            dimension: 'mass',
            unit: 'kg',
            representative: '1',
            approximation: 'exact',
            source: 'test fixture',
          },
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
          length: {
            dimension: 'length',
            unit: 's',
            representative: '1',
            approximation: 'exact',
            source: 'test fixture',
          },
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
            source: 'test fixture',
          },
        },
      }),
    ).toThrow(/min is greater than max/);
  });

  it('refuses a measured or exact value with nothing behind it', () => {
    // "Measured" and "exact" are claims a reader could go and check. Letting one
    // through uncited is how a plausible round number ends up looking like a
    // fact, which is the failure this whole project is about.
    for (const approximation of ['exact', 'measured']) {
      expect(() =>
        parseScaleObject({
          id: 'x',
          name: 'x',
          quantities: {
            length: { dimension: 'length', unit: 'm', representative: '1', approximation },
          },
        }),
      ).toThrow(/needs a source/);
    }
  });

  it('allows a representative or estimated value to have no source', () => {
    for (const approximation of ['representative', 'estimated']) {
      expect(() =>
        parseScaleObject({
          id: 'x',
          name: 'x',
          quantities: {
            length: { dimension: 'length', unit: 'm', representative: '1', approximation },
          },
        }),
      ).not.toThrow();
    }
  });

  it('refuses a provenance status written into the source field', () => {
    expect(() =>
      parseScaleObject({
        id: 'x',
        name: 'x',
        quantities: {
          length: {
            dimension: 'length',
            unit: 'm',
            representative: '1',
            approximation: 'representative',
            source: 'Demonstration Value',
          },
        },
      }),
    ).toThrow(/is a provenance status, not a source/);
  });

  it('rejects an object with no quantities, which could not be compared', () => {
    expect(() => parseScaleObject({ id: 'x', name: 'x', quantities: {} })).toThrow(CatalogError);
  });

  it('rejects duplicate ids and dangling relations', () => {
    const object = {
      id: 'x',
      name: 'x',
      quantities: {
        length: {
          dimension: 'length',
          unit: 'm',
          representative: '1',
          approximation: 'exact',
          source: 'test fixture',
        },
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
        length: {
          dimension: 'length',
          unit: 'm',
          representative: '1',
          approximation: 'exact',
          source: 'test fixture',
        },
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
          length: {
            dimension: 'length',
            unit: 'm',
            representative: '1',
            approximation: 'exact',
            source: 'test fixture',
          },
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
        length: {
          dimension: 'length',
          unit: 'm',
          representative: '3/20',
          approximation: 'exact',
          source: 'test fixture',
        },
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
          source: 'test fixture',
        },
      },
    });
    expect(primaryLength(asString)?.value).toEqual(primaryLength(asFraction)?.value);
  });
});

describe('which length an object is', () => {
  /** Two lengths, `width` written first, `height` optionally declared primary. */
  const twoLengths = (primaryKey?: 'width' | 'height') => [
    {
      id: 'x',
      name: 'x',
      quantities: {
        width: {
          dimension: 'length',
          unit: 'm',
          representative: '0.8',
          approximation: 'representative',
          ...(primaryKey === 'width' ? { primary: true } : {}),
        },
        height: {
          dimension: 'length',
          unit: 'm',
          representative: '2',
          approximation: 'representative',
          ...(primaryKey === 'height' ? { primary: true } : {}),
        },
      },
    },
  ];

  it('is the declared one, not the one written first', () => {
    // The defect this closes: `primaryLength` returned whatever `Object.values`
    // came to first, so the atlas positioned an object by whichever length its
    // author happened to type above the other.
    const [object] = createCatalog(twoLengths('height')).objects;
    expect(Object.keys(object!.quantities)[0]).toBe('width');
    expect(primaryLength(object!)?.key).toBe('height');
    expect(toUnit(primaryLength(object!)!.value, 'm')).toEqual(rational(2n));
  });

  it('refuses two lengths with none declared', () => {
    expect(() => createCatalog(twoLengths())).toThrow(/mark exactly one/);
  });

  it('refuses two lengths with both declared', () => {
    const both = twoLengths('height');
    (both[0]!.quantities.width as Record<string, unknown>)['primary'] = true;
    expect(() => createCatalog(both)).toThrow(/2 marked primary/);
  });

  it('needs no declaration when there is only one length', () => {
    // Twenty-seven of the twenty-eight objects, and the rule must not make
    // every one of them carry a flag that decides nothing.
    const single = CATALOG.objects.filter(
      (object) =>
        Object.values(object.quantities).filter((q) => q.dimension === 'length').length === 1,
    );
    expect(single.length).toBeGreaterThan(20);
    for (const object of single) {
      expect(primaryLength(object)?.primary, object.id).toBeUndefined();
      expect(primaryLength(object), object.id).toBeDefined();
    }
  });

  it('positions the door by its height, and remembers its width', () => {
    const door = CATALOG.require('door');
    expect(primaryLength(door)?.key).toBe('height');
    expect(allLengths(door).map((one) => one.key)).toEqual(['height', 'width']);
    // Anti-vacuity for the rule above: if nothing in the fixture had two
    // lengths, none of this would be exercised by the real catalog at all.
    expect(allLengths(door)).toHaveLength(2);
  });
});

describe('objects are frozen', () => {
  it('cannot be mutated after loading', () => {
    const coconut = CATALOG.require('coconut');
    expect(Object.isFrozen(coconut)).toBe(true);
    expect(Object.isFrozen(coconut.quantities)).toBe(true);
  });
});

describe('a citation and the number under it agree', () => {
  // The failure this guards is the one the schema cannot catch: a source string
  // that is a real reference, attached to a number the reference does not
  // support. `solar-system` was 60.2 au while its stated derivation — twice
  // Neptune's semi-major axis of 30.07 au — gives 60.14. A reader who checked
  // would have found it off, which is worse than no citation at all.
  it('derives the Solar System width from the semi-major axis it cites', () => {
    const length = requireLength(CATALOG.require('solar-system'));
    expect(length.source, 'no longer cites a semi-major axis').toContain('30.07 au');
    // The stored value is in metres, so the derivation is checked in metres:
    // twice 30.07 au, at the IAU's exact 149 597 870 700 m per au.
    const au = rational(149597870700n);
    expect(length.value.value).toEqual(mul(parseDecimalExact('30.07'), mul(rational(2n), au)));
  });

  it('keeps the conventional figures representative, reference or not', () => {
    // An atom, a helix and a solar system have no edge. Their sources name the
    // convention the number comes from; they do not assert a measured boundary,
    // and the claim must stay `representative` to say so.
    for (const id of ['hydrogen-atom', 'dna-helix', 'solar-system']) {
      const length = requireLength(CATALOG.require(id));
      expect(length.source, `${id} lost its source`).toBeDefined();
      expect(length.approximation, `${id} now claims more than a convention`).toBe(
        'representative',
      );
    }
  });
});

describe('a source has to name something checkable', () => {
  // Mutation testing found this gap. The whole-string placeholder set catches
  // `source: "TBD"`, and the test above catches a source that *starts* with
  // one — but neither caught a real citation wearing a vague qualifier, which
  // is the shape TASKS names: "typical of virology texts" is a claim nobody
  // can go and check, and it reads like provenance in every table.
  const withSource = (source: string) => () =>
    parseScaleObject({
      id: 'probe',
      name: 'Probe',
      categories: ['test'],
      quantities: {
        length: {
          dimension: 'length',
          unit: 'm',
          representative: '1',
          approximation: 'representative',
          source,
        },
      },
    });

  it('rejects a consensus dressed as a reference, even beside a real one', () => {
    expect(withSource('typical of structural biology texts; Arnott & Hukins 1972')).toThrow(
      /typical of/,
    );
    expect(withSource('Commonly cited in the literature')).toThrow(/commonly cited/);
    expect(withSource('various sources')).toThrow(/various sources/);
  });

  it('still accepts the citations the catalog actually carries', () => {
    // Anti-vacuity, and a guard against over-rejecting: every source in the
    // fixture must survive the rule that was just added.
    for (const object of CATALOG.objects) {
      const source = requireLength(object).source;
      if (source === undefined) continue;
      expect(withSource(source), `${object.id}: ${source}`).not.toThrow();
    }
  });
});
