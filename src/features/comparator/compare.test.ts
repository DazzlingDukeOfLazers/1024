import { describe, expect, it } from 'vitest';
import {
  ComparisonError,
  type Subject,
  areaRatio,
  difference,
  endToEnd,
  howManyFit,
  howManyFitByVolume,
  isExactSubject,
  ratio,
  relativeSpread,
  subjectFromCatalog,
  subjectFromQuantity,
  volumeRatio,
  wholeItemsToSpan,
} from './compare';
import { RANDOM_CLOSE_PACKING } from './packing';
import { CATALOG } from '../../catalog/catalog';
import { ONE, equals, gt, lt, rational } from '../../core/rational/rational';
import { parseDecimalExact } from '../../core/rational/parse';
import { fromUnit, toUnit, zeroQuantity } from '../../core/quantities/quantity';
import { formatCount, formatEngineering } from '../../core/units/format';

const r = rational;

const millimetre = subjectFromQuantity('1 mm', fromUnit(ONE, 'mm'));
const micrometre = subjectFromQuantity('1 µm', fromUnit(ONE, 'µm'));
const cell = subjectFromCatalog(CATALOG.require('red-blood-cell'));
const coconut = subjectFromCatalog(CATALOG.require('coconut'));
const human = subjectFromCatalog(CATALOG.require('human'));
const lightYear = subjectFromCatalog(CATALOG.require('light-year'));
const au = subjectFromCatalog(CATALOG.require('astronomical-unit'));

describe('exact conversion is not approximate comparison', () => {
  it('calls a ratio between two definitions exact', () => {
    const result = ratio(millimetre, micrometre);
    expect(result.value).toEqual(r(1000n));
    expect(result.certainty).toBe('exact');
    expect(result.approximateBecause).toEqual([]);
    expect(result.range).toBeUndefined();
  });

  it('calls a ratio between two defined astronomical units exact too', () => {
    const result = ratio(lightYear, au);
    expect(result.certainty).toBe('exact');
    // 9460730472580800 / 149597870700 — an exact rational, not a rounded 63241.
    expect(result.value).toEqual(r(9460730472580800n, 149597870700n));
    // 63241.077…, so the default four significant digits round the tail away.
    expect(formatCount(result.value).text).toBe('63240');
    expect(formatCount(result.value, 6).text).toBe('63241.1');
  });

  it('calls a comparison involving a measurement approximate, and says which', () => {
    const result = howManyFit(cell, millimetre);
    expect(result.certainty).toBe('approximate');
    expect(result.approximateBecause).toEqual(['Red blood cell (diameter)']);
  });

  it('never lets the arithmetic itself be the source of doubt', () => {
    // The division is exact whatever the inputs are; only the inputs are fuzzy.
    const result = howManyFit(cell, millimetre);
    expect(result.value).toEqual(r(400n, 3n));
    expect(equals(result.value, r(400n, 3n))).toBe(true);
  });
});

describe('how many red blood cells span a millimetre', () => {
  const result = howManyFit(cell, millimetre);

  it('answers about 133', () => {
    // 1 mm / 7.5 µm = 400/3, exactly, given a 7.5 µm cell.
    expect(result.value).toEqual(r(400n, 3n));
    expect(formatCount(result.value).text).toBe('133.3');
  });

  it('propagates the range of the cell into the answer', () => {
    expect(result.range).toBeDefined();
    // A bigger cell means fewer fit, so the range inverts: 1 mm / 8.2 µm at the
    // low end and 1 mm / 6.2 µm at the high end.
    expect(result.range!.min).toEqual(r(5000n, 41n));
    expect(result.range!.max).toEqual(r(5000n, 31n));
    expect(lt(result.range!.min, result.value)).toBe(true);
    expect(gt(result.range!.max, result.value)).toBe(true);
  });

  it('reports how uncertain that is', () => {
    const spread = relativeSpread(result);
    expect(spread).toBeDefined();
    // Roughly ±12%: the honest answer is "about 130", not "133.333".
    expect(gt(spread!, parseDecimalExact('0.10'))).toBe(true);
    expect(lt(spread!, parseDecimalExact('0.15'))).toBe(true);
  });

  it('says how many whole cells you would actually have to lay out', () => {
    const { count, remainder } = wholeItemsToSpan(cell, millimetre);
    expect(count).toBe(134n);
    // 134 cells overshoot a millimetre slightly.
    expect(gt(remainder.value, zeroQuantity('length').value)).toBe(true);
  });
});

describe('123 coconuts', () => {
  const count = r(123n);
  const result = endToEnd(coconut, count);

  it('needs a dimension before it means anything', () => {
    // The operation takes a subject — a named quantity of a named object — so a
    // bare count can never be turned into a length by accident.
    expect(result.a.label).toBe('Coconut (length)');
    expect(result.count).toEqual(count);
  });

  it('lays out 24.6 m', () => {
    expect(result.value.value).toEqual(parseDecimalExact('24.6'));
    expect(formatEngineering(result.value).text).toBe('24.6 m');
  });

  it('carries the coconut range through, because coconuts vary', () => {
    expect(result.range).toBeDefined();
    expect(result.range!.min.value).toEqual(parseDecimalExact('18.45'));
    expect(result.range!.max.value).toEqual(parseDecimalExact('36.9'));
    expect(result.certainty).toBe('approximate');
  });

  it('is exact when the object itself is a definition', () => {
    const result = endToEnd(au, r(2n));
    expect(result.certainty).toBe('exact');
    expect(result.range).toBeUndefined();
    expect(result.value.value).toEqual(r(299195741400n));
  });

  it('refuses a negative count', () => {
    expect(() => endToEnd(coconut, r(-1n))).toThrow(ComparisonError);
  });

  it('handles a fractional count exactly', () => {
    expect(endToEnd(coconut, r(1n, 2n)).value.value).toEqual(parseDecimalExact('0.10'));
  });
});

describe('ratio and difference', () => {
  it('compares a human with a coconut', () => {
    const result = ratio(human, coconut);
    expect(result.value).toEqual(r(17n, 2n));
    expect(result.certainty).toBe('approximate');
    // Both vary, so the answer spans a wide range.
    expect(result.range!.min).toEqual(r(14n, 3n));
    expect(lt(result.range!.min, result.value)).toBe(true);
    expect(gt(result.range!.max, result.value)).toBe(true);
  });

  it('subtracts, keeping the dimension', () => {
    const result = difference(human, coconut);
    expect(result.value.dimension).toBe('length');
    expect(result.value.value).toEqual(parseDecimalExact('1.5'));
    expect(result.range!.min.value).toEqual(parseDecimalExact('1.1'));
    expect(result.range!.max.value).toEqual(parseDecimalExact('1.85'));
  });

  it('subtracts exactly between definitions', () => {
    const result = difference(lightYear, au);
    expect(result.certainty).toBe('exact');
    expect(result.value.value).toEqual(r(9460730472580800n - 149597870700n));
  });
});

describe('refusals', () => {
  it('will not compare across dimensions', () => {
    const second = subjectFromQuantity('1 s', fromUnit(ONE, 's'));
    expect(() => ratio(millimetre, second)).toThrow(/Cannot compare a length with a time/);
  });

  it('will not divide by a zero quantity', () => {
    const nothing = subjectFromQuantity('nothing', zeroQuantity('length'));
    expect(() => ratio(millimetre, nothing)).toThrow(ComparisonError);
  });

  it('will not read a quantity an object does not have', () => {
    expect(() => subjectFromCatalog(CATALOG.require('coconut'), 'mass')).toThrow(ComparisonError);
  });
});

describe('subjects', () => {
  it('treats a unit literal as an exact definition', () => {
    expect(isExactSubject(millimetre)).toBe(true);
    expect(millimetre.approximation).toBe('exact');
  });

  it('treats a measured catalog entry as inexact even without a range', () => {
    const moon = subjectFromCatalog(CATALOG.require('moon'));
    expect(moon.range).toBeUndefined();
    expect(isExactSubject(moon)).toBe(false);
    expect(ratio(moon, millimetre).certainty).toBe('approximate');
  });

  it('carries provenance through to the result', () => {
    expect(coconut.source).toBe('PROJECT_SPEC.md section 16');
    expect(au.note).toContain('defined constant');
  });
});

describe('the scale span the atlas will need', () => {
  it('compares the very small with the very large without losing either', () => {
    const planck = subjectFromCatalog(CATALOG.require('planck-length'));
    const universe = subjectFromCatalog(CATALOG.require('observable-universe'));
    const result = howManyFit(planck, universe);

    // About 5e61 Planck lengths across the observable universe. Exactly
    // computed, and far outside anything binary64 could have divided.
    expect(formatCount(result.value).text).toContain('× 10^61');
    expect(result.certainty).toBe('approximate');
  });

  it('keeps a millimetre measurable against a light-year', () => {
    const result = howManyFit(millimetre, lightYear);
    expect(result.certainty).toBe('exact');
    expect(result.value).toEqual(r(9460730472580800000n));
    expect(toUnit(lightYear.value, 'mm')).toEqual(result.value);
  });
});

describe('area and volume, where the geometry is an assumption rather than a fact', () => {
  const metres = (value: bigint) => fromUnit(rational(value), 'm');
  const twoMetres = subjectFromQuantity('two metres', metres(2n));
  const oneMetre = subjectFromQuantity('one metre', metres(1n));

  it('squares and cubes the length ratio exactly', () => {
    expect(areaRatio(twoMetres, oneMetre).value).toEqual(rational(4n));
    expect(volumeRatio(twoMetres, oneMetre).value).toEqual(rational(8n));
    // Exactly, in both directions — a third cubes to a twenty-seventh, not to
    // 0.037037037.
    expect(volumeRatio(oneMetre, subjectFromQuantity('3 m', metres(3n))).value).toEqual(
      rational(1n, 27n),
    );
  });

  it('says what it assumed, on the result, every time', () => {
    // The whole point of the operation. A number that is only true for similar
    // shapes, presented without that condition, is the defect this project
    // exists to avoid — and it would be invisible, because the arithmetic is
    // perfect.
    for (const result of [areaRatio(twoMetres, oneMetre), volumeRatio(twoMetres, oneMetre)]) {
      expect(result.assumes, result.operation).toEqual([
        'both objects have the same shape, at different sizes',
      ]);
    }
  });

  it('keeps the assumption separate from the input precision', () => {
    // Two exactly defined metres: nothing about the *inputs* is approximate,
    // and the answer is still conditional. Folding the two together would let
    // "exact" mean "true", which it does not.
    const result = volumeRatio(twoMetres, oneMetre);
    expect(result.certainty).toBe('exact');
    expect(result.approximateBecause).toEqual([]);
    expect(result.assumes).toHaveLength(1);
  });

  it('carries the assumption on a real catalog pair, and the imprecision too', () => {
    const coconut = subjectFromCatalog(CATALOG.require('coconut'));
    const house = subjectFromCatalog(CATALOG.require('house'));
    const result = volumeRatio(house, coconut);
    expect(result.certainty).toBe('approximate');
    expect(result.approximateBecause.length).toBeGreaterThan(0);
    expect(result.assumes).toHaveLength(1);
  });

  it('propagates a range through the power, widest to widest', () => {
    const wide: typeof oneMetre = {
      label: 'wide',
      dimension: 'length',
      value: metres(2n),
      range: { min: metres(1n), max: metres(3n) },
      approximation: 'representative',
    };
    const result = volumeRatio(wide, oneMetre);
    expect(result.range?.min).toEqual(rational(1n));
    expect(result.range?.max).toEqual(rational(27n));
    // And the range brackets the representative answer.
    expect(lt(result.range!.min, result.value)).toBe(true);
    expect(lt(result.value, result.range!.max)).toBe(true);
  });

  it('omits the range when neither subject has one', () => {
    expect('range' in areaRatio(twoMetres, oneMetre)).toBe(false);
  });

  it('refuses a zero denominator, like the length ratio it is built on', () => {
    const zero = subjectFromQuantity('zero', zeroQuantity('length'));
    expect(() => volumeRatio(twoMetres, zero)).toThrow(ComparisonError);
  });
});

describe('how many fit inside, where spheres do not tile', () => {
  const metres = (value: bigint) => fromUnit(rational(value), 'm');
  const oneMetre = subjectFromQuantity('one metre', metres(1n));
  const tenMetres = subjectFromQuantity('ten metres', metres(10n));

  it('is the volume ratio times the packing fraction, exactly', () => {
    // A thousand unit cubes would fill a ten-metre cube; a thousand unit
    // *spheres* poured in do not, and the gap is more than a third.
    expect(volumeRatio(tenMetres, oneMetre).value).toEqual(rational(1000n));
    // 1000 × 3183/5000, in lowest terms. Not 636.6, and not 636.
    expect(howManyFitByVolume(oneMetre, tenMetres).value).toEqual(rational(3183n, 5n));
  });

  it('uses a packing fraction that was measured, not chosen', () => {
    expect(RANDOM_CLOSE_PACKING.nominal).toEqual(rational(3183n, 5000n));
    expect(RANDOM_CLOSE_PACKING.source).toContain('Scott');
    expect(RANDOM_CLOSE_PACKING.source).toContain('J. Phys. D');
    expect(RANDOM_CLOSE_PACKING.uncertainty?.value).toEqual(rational(1n, 2000n));

    // And it is not the theoretical maximum wearing a different name: pouring
    // reaches 0.6366, the densest possible arrangement is about 0.7405, and
    // using the second to answer "how many fit" would overstate by a sixth.
    expect(lt(RANDOM_CLOSE_PACKING.nominal, rational(7405n, 10000n))).toBe(true);
  });

  it('says all three things it assumed, not just the geometric one', () => {
    const result = howManyFitByVolume(oneMetre, tenMetres);
    expect(result.assumes).toHaveLength(3);
    expect(result.assumes?.[0]).toBe('both objects have the same shape, at different sizes');
    expect(result.assumes?.[1]).toContain('pours and settles');
    expect(result.assumes?.[1]).toContain('Scott');
    // The number as its source published it. `3183/5000 of the space` is what
    // the panel said first: right, unreadable, and not checkable against the
    // paper.
    expect(result.assumes?.[1]).toContain('0.6366 of the space');
    expect(result.assumes?.[1]).not.toContain('3183');
    expect(result.assumes?.[2]).toContain('walls do not dominate');
  });

  it('is exact and conditional at the same time', () => {
    // Two exactly defined lengths. Nothing about the inputs is approximate, the
    // arithmetic is exact rational, and the answer still rests on three
    // assumptions. `exact` has never meant `true`.
    const result = howManyFitByVolume(oneMetre, tenMetres);
    expect(result.certainty).toBe('exact');
    expect(result.approximateBecause).toEqual([]);
    expect(result.assumes).toHaveLength(3);
  });

  it('keeps the model uncertainty out of the input range', () => {
    // The packing fraction is ±0.0005, and that is uncertainty in the *model*.
    // `range` carries uncertainty in the inputs, so a pair of exact lengths has
    // no range at all even though the model has a spread.
    expect('range' in howManyFitByVolume(oneMetre, tenMetres)).toBe(false);

    const wide: Subject = {
      label: 'wide',
      dimension: 'length',
      value: metres(2n),
      range: { min: metres(1n), max: metres(4n) },
      approximation: 'representative',
    };
    const result = howManyFitByVolume(wide, tenMetres);
    // A *larger* item means fewer fit, so the wide bound gives the small count.
    expect(result.range?.min).toEqual(rational(3183n, 320n));
    expect(result.range?.max).toEqual(rational(3183n, 5n));
    expect(lt(result.range!.min, result.value)).toBe(true);
  });

  it('answers the question people actually ask', () => {
    const coconut = subjectFromCatalog(CATALOG.require('coconut'));
    const house = subjectFromCatalog(CATALOG.require('house'));
    const result = howManyFitByVolume(coconut, house);

    // 125,000 coconut-volumes of house, of which the coconuts occupy 0.6366.
    expect(volumeRatio(house, coconut).value).toEqual(rational(125000n));
    expect(result.value).toEqual(rational(79575n));
    // And it is the smaller number: the naive answer is the one that is wrong.
    expect(lt(result.value, volumeRatio(house, coconut).value)).toBe(true);
  });

  it('is not the same operation as fitting them across', () => {
    // Fifty coconuts span a house; eighty thousand fill it. Same two objects,
    // different questions, and the operation is what distinguishes them.
    const coconut = subjectFromCatalog(CATALOG.require('coconut'));
    const house = subjectFromCatalog(CATALOG.require('house'));
    expect(howManyFit(coconut, house).value).toEqual(rational(50n));
    expect(howManyFit(coconut, house).assumes).toBeUndefined();
    expect(howManyFitByVolume(coconut, house).assumes).toHaveLength(3);
  });

  it('answers none when the item is larger than the container', () => {
    // This used to answer 6.366 × 10^-19 for "how many kilometres fit inside a
    // millimetre" — the packing fraction applied to a volume ratio nowhere near
    // anything it describes. Not a fraction of an item, because a fraction of
    // an item is not a thing, and not a ratio either, because multiplying by
    // 0.6366 stopped it being one. It is zero, and it needs no model.
    const result = howManyFitByVolume(tenMetres, oneMetre);
    expect(result.value).toEqual(rational(0n));
    expect('range' in result).toBe(false);
  });

  it('does not consult the packing model when nothing fits', () => {
    // The model is for many items far from a wall. Citing it under an answer it
    // played no part in would be the same defect as a source attached to a
    // number it does not support.
    const result = howManyFitByVolume(tenMetres, oneMetre);
    expect(result.assumes).toHaveLength(2);
    expect(result.assumes?.[0]).toBe('both objects have the same shape, at different sizes');
    expect(result.assumes?.[1]).toContain('the packing model is not used');
    expect(result.assumes?.some((one) => one.includes('Scott'))).toBe(false);
    expect(result.assumes?.some((one) => one.includes('walls do not dominate'))).toBe(false);
  });

  it('still consults it the moment something does fit', () => {
    // Anti-vacuity for the two above: the boundary is exact and one side of it
    // has to behave differently from the other, or the guard does nothing.
    const justFits = howManyFitByVolume(oneMetre, tenMetres);
    expect(lt(rational(0n), justFits.value)).toBe(true);
    expect(justFits.assumes).toHaveLength(3);

    // And at exactly equal sizes one fits, so the model is still consulted:
    // the boundary is "smaller than", not "not larger than".
    const equal = howManyFitByVolume(oneMetre, subjectFromQuantity('another metre', metres(1n)));
    expect(equal.assumes).toHaveLength(3);
    expect(lt(rational(0n), equal.value)).toBe(true);
  });

  it('refuses a zero item, like every other ratio here', () => {
    const zero = subjectFromQuantity('zero', zeroQuantity('length'));
    expect(() => howManyFitByVolume(zero, tenMetres)).toThrow(ComparisonError);
  });
});
