import { describe, expect, it } from 'vitest';
import {
  type ScaleBand,
  bandFor,
  bandFromExtent,
  edgesOf,
  log10Of,
  neighbourIds,
  relationPath,
  revealedIn,
  suggestFrom,
  visibilityIn,
} from './graph';
import { CATALOG, createCatalog } from './catalog';
import { pow10 } from '../core/rational/rational';

const ids = (path: ReturnType<typeof relationPath>) => path?.map((step) => step.object.id);

describe('edges', () => {
  it('reads the relation an object authored', () => {
    const edges = edgesOf(CATALOG, 'hand');
    const toHuman = edges.find((edge) => edge.target.id === 'human');
    expect(toHuman?.type).toBe('part-of');
    expect(toHuman?.inverse).toBe(false);
    expect(toHuman?.label).toBe('part of');
  });

  it('derives the inverse rather than making the fixture write it twice', () => {
    const edges = edgesOf(CATALOG, 'human');
    const toHand = edges.find((edge) => edge.target.id === 'hand');
    expect(toHand?.inverse).toBe(true);
    expect(toHand?.label).toBe('has part');

    // The fixture only ever names one direction.
    expect(CATALOG.require('human').relations).toEqual([]);
    expect(CATALOG.require('hand').relations).toEqual([{ type: 'part-of', targetId: 'human' }]);
  });

  it('labels every relation type in the fixture, in both directions', () => {
    for (const object of CATALOG.objects) {
      for (const edge of edgesOf(CATALOG, object.id)) {
        expect(edge.label, `${object.id} -> ${edge.target.id}`).not.toContain('(inverse)');
      }
    }
  });

  it('gives an object several relations at once, as a graph should', () => {
    // docs/DATA_MODEL.md §15: not a single tree.
    const earth = neighbourIds(CATALOG, 'earth');
    expect(earth).toContain('sun');
    expect(earth).toContain('solar-system');
    expect(earth).toContain('moon');

    const cell = neighbourIds(CATALOG, 'skin-cell');
    expect(cell).toContain('finger');
    expect(cell).toContain('dna-helix');
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(edgesOf(CATALOG, 'nope')).toEqual([]);
  });
});

describe('walking the graph', () => {
  it('finds the chain PROJECT_SPEC §14 describes', () => {
    // human → hand → finger → skin cell → DNA, discovered rather than listed.
    expect(ids(relationPath(CATALOG, 'human', 'dna-helix'))).toEqual([
      'human',
      'hand',
      'finger',
      'skin-cell',
      'dna-helix',
    ]);
  });

  it('crosses from the biological chain into the physical one', () => {
    const path = ids(relationPath(CATALOG, 'skin-cell', 'proton'));
    expect(path?.[0]).toBe('skin-cell');
    expect(path?.at(-1)).toBe('proton');
    expect(path).toContain('hydrogen-atom');
  });

  it('walks outward through the astronomical relations', () => {
    expect(ids(relationPath(CATALOG, 'moon', 'observable-universe'))).toEqual([
      'moon',
      'earth',
      'sun',
      'milky-way',
      'observable-universe',
    ]);
  });

  it('records how each step was reached', () => {
    const path = relationPath(CATALOG, 'finger', 'human')!;
    expect(path[0]?.via).toBeUndefined();
    expect(path[1]?.via?.label).toBe('part of');
    expect(path.at(-1)?.object.id).toBe('human');
  });

  it('is a single step to itself', () => {
    expect(ids(relationPath(CATALOG, 'coconut', 'coconut'))).toEqual(['coconut']);
  });

  it('says so when the graph does not connect two things', () => {
    // A coconut has no authored relations, so nothing reaches it.
    expect(relationPath(CATALOG, 'human', 'coconut')).toBeUndefined();
    expect(relationPath(CATALOG, 'human', 'nope')).toBeUndefined();
  });

  it('finds the shortest path, not the first one', () => {
    const viaSolarSystem = relationPath(CATALOG, 'earth', 'milky-way')!;
    expect(viaSolarSystem).toHaveLength(3);
  });
});

describe('scale bands', () => {
  const band: ScaleBand = { minLog10: -6, maxLog10: -3 };

  it('sorts objects into below, in and above', () => {
    expect(visibilityIn(band, -4)).toBe('in-band');
    expect(visibilityIn(band, -9)).toBe('below-band');
    expect(visibilityIn(band, 0)).toBe('above-band');
  });

  it('derives a band around an object when the fixture has no opinion', () => {
    const coconut = bandFor(CATALOG.require('coconut'));
    const centre = log10Of(CATALOG.require('coconut'));
    expect(coconut.minLog10).toBeCloseTo(centre - 2, 9);
    expect(coconut.maxLog10).toBeCloseTo(centre + 2, 9);
  });

  it('builds a band from an exact visible extent', () => {
    const fromCamera = bandFromExtent(pow10(-9), pow10(-3));
    expect(fromCamera.minLog10).toBeCloseTo(-9, 9);
    expect(fromCamera.maxLog10).toBeCloseTo(-3, 9);
  });
});

describe('suggestions from where you are standing', () => {
  it('puts what is already in view first', () => {
    // Standing at human scale, a hand is here and DNA is not.
    const band = bandFor(CATALOG.require('human'));
    const suggestions = suggestFrom(CATALOG, 'human', band);

    expect(suggestions[0]?.object.id).toBe('hand');
    expect(suggestions[0]?.visibility).toBe('in-band');
    expect(suggestions[0]?.decadesAway).toBe(0);

    const cell = suggestions.find((entry) => entry.object.id === 'red-blood-cell')!;
    expect(cell.visibility).toBe('below-band');
    expect(cell.decadesAway).toBeGreaterThan(2);
  });

  it('keeps what is out of view and says how far, rather than hiding it', () => {
    // "Zoom in and there is more" is the idea; dropping them would defeat it.
    const band = bandFor(CATALOG.require('human'));
    const ids = suggestFrom(CATALOG, 'human', band).map((entry) => entry.object.id);
    expect(ids).toContain('red-blood-cell');
    expect(ids).toContain('human-hair');
    expect(ids).toContain('hand');
  });

  it('changes what is nearby as the band moves', () => {
    const atHuman = suggestFrom(CATALOG, 'human', bandFor(CATALOG.require('human')));
    const atCell = suggestFrom(CATALOG, 'human', bandFor(CATALOG.require('red-blood-cell')));

    expect(atHuman.find((entry) => entry.object.id === 'red-blood-cell')?.visibility).toBe(
      'below-band',
    );
    expect(atCell.find((entry) => entry.object.id === 'red-blood-cell')?.visibility).toBe(
      'in-band',
    );
  });

  it('is empty for an object with no relations', () => {
    expect(suggestFrom(CATALOG, 'coconut', bandFor(CATALOG.require('coconut')))).toEqual([]);
  });
});

describe('what else lives at this size', () => {
  it('reveals unrelated neighbours by scale alone', () => {
    const band = bandFromExtent(pow10(-6), pow10(-4));
    const ids = revealedIn(CATALOG, band).map((entry) => entry.object.id);

    expect(ids).toContain('red-blood-cell');
    expect(ids).toContain('bacterium');
    expect(ids).toContain('skin-cell');
    expect(ids).not.toContain('human');
  });

  it('can leave the current selection out', () => {
    const band = bandFromExtent(pow10(-6), pow10(-4));
    expect(
      revealedIn(CATALOG, band, ['red-blood-cell']).map((entry) => entry.object.id),
    ).not.toContain('red-blood-cell');
  });

  it('can leave out everything already named elsewhere', () => {
    // The panel shows this list under "unrelated to the selection", so the
    // caller has to be able to remove the relations it printed above it.
    const band = bandFromExtent(pow10(-6), pow10(-4));
    const everything = revealedIn(CATALOG, band).map((entry) => entry.object.id);
    expect(everything).toContain('skin-cell');
    expect(everything).toContain('bacterium');

    const remaining = revealedIn(CATALOG, band, ['skin-cell', 'bacterium']).map(
      (entry) => entry.object.id,
    );
    expect(remaining).not.toContain('skin-cell');
    expect(remaining).not.toContain('bacterium');
    // Anti-vacuity: excluding two must not be excluding everything.
    expect(remaining.length).toBe(everything.length - 2);
  });

  it('returns them smallest first', () => {
    const revealed = revealedIn(CATALOG, bandFromExtent(pow10(-9), pow10(0)));
    for (let i = 1; i < revealed.length; i += 1) {
      expect(revealed[i]!.log10).toBeGreaterThanOrEqual(revealed[i - 1]!.log10);
    }
  });
});

describe('the fixture graph is well formed', () => {
  /** A minimal loadable object, so a relation can be the only thing under test. */
  const object = (id: string, relations: { type: string; targetId: string }[]) => ({
    id,
    name: id,
    quantities: {
      length: {
        dimension: 'length',
        unit: 'm',
        representative: '1',
        approximation: 'exact',
        source: 'test fixture',
      },
    },
    relations,
  });

  it('has no relation pointing at a missing object', () => {
    // createCatalog enforces it at load; this is the assertion that says so.
    expect(() => createCatalog([object('x', [{ type: 'part-of', targetId: 'nowhere' }])])).toThrow(
      /unknown object/,
    );
  });

  it('refuses a relation authored in both directions', () => {
    // The inverse is derived, so authoring it as well makes one fact into two
    // edges, and the panel lists the same neighbour twice.
    expect(() =>
      createCatalog([
        object('a', [{ type: 'contains', targetId: 'b' }]),
        object('b', [{ type: 'contained-by', targetId: 'a' }]),
      ]),
    ).toThrow(/author one direction only/);

    // One direction alone loads, so the rule rejects the duplicate rather than
    // the relation.
    expect(() =>
      createCatalog([object('a', [{ type: 'contains', targetId: 'b' }]), object('b', [])]),
    ).not.toThrow();
  });

  it('refuses a second relation between the same pair, whatever it is called', () => {
    // Two different types are the worse case, not a lesser one: the panel then
    // names the same object twice under two different words.
    expect(() =>
      createCatalog([
        object('a', [
          { type: 'part-of', targetId: 'b' },
          { type: 'within', targetId: 'b' },
        ]),
        object('b', []),
      ]),
    ).toThrow(/author one direction only/);
  });

  it('refuses an object related to itself', () => {
    expect(() => createCatalog([object('a', [{ type: 'part-of', targetId: 'a' }])])).toThrow(
      /points at itself/,
    );
  });

  it('names each neighbour exactly once', () => {
    let longest = 0;
    for (const subject of CATALOG.objects) {
      const seen = edgesOf(CATALOG, subject.id).map((edge) => edge.target.id);
      expect(new Set(seen).size, `${subject.id} lists ${seen.join(', ')}`).toBe(seen.length);
      longest = Math.max(longest, seen.length);
    }
    // Anti-vacuity: a catalog of one-edge objects could not show a duplicate.
    expect(longest).toBeGreaterThan(2);
  });

  it('connects every authored relation in both directions', () => {
    for (const object of CATALOG.objects) {
      for (const relation of object.relations) {
        const back = edgesOf(CATALOG, relation.targetId);
        expect(
          back.some((edge) => edge.target.id === object.id && edge.inverse),
          `${relation.targetId} does not see ${object.id}`,
        ).toBe(true);
      }
    }
  });

  it('leaves most objects unrelated, which is honest', () => {
    // Relations are authored where they mean something. A grain of sand is not
    // part of anything in this catalog, and pretending otherwise would be worse
    // than an empty list.
    const withRelations = CATALOG.objects.filter(
      (object) => edgesOf(CATALOG, object.id).length > 0,
    );
    expect(withRelations.length).toBeGreaterThan(10);
    expect(withRelations.length).toBeLessThan(CATALOG.objects.length);
  });
});
