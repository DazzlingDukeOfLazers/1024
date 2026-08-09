import { describe, expect, it } from 'vitest';
import {
  ComparisonError,
  difference,
  endToEnd,
  howManyFit,
  isExactSubject,
  ratio,
  relativeSpread,
  subjectFromCatalog,
  subjectFromQuantity,
  wholeItemsToSpan,
} from './compare';
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
