import { describe, expect, it } from 'vitest';
import { UnitError, conversionFactor, findUnit, requireUnit } from './units';
import {
  ENGINEERING_PREFIXES,
  SI_PREFIXES,
  engineeringExponentFor,
  prefixBySymbol,
} from './prefixes';
import { canonicalUnitOf, isDimensionKind } from './dimensions';
import { equals, pow10, rational } from '../rational/rational';

describe('dimensions', () => {
  it('exposes canonical SI units', () => {
    expect(canonicalUnitOf('length')).toBe('m');
    expect(canonicalUnitOf('time')).toBe('s');
  });

  it('guards unknown dimension names', () => {
    expect(isDimensionKind('length')).toBe(true);
    expect(isDimensionKind('mass')).toBe(false);
  });
});

describe('prefixes', () => {
  it('covers the full modern SI range', () => {
    expect(SI_PREFIXES[0]?.exponent).toBe(30);
    expect(SI_PREFIXES[SI_PREFIXES.length - 1]?.exponent).toBe(-30);
  });

  it('lists only powers of 1000 as engineering prefixes', () => {
    expect(ENGINEERING_PREFIXES.every((p) => p.exponent % 3 === 0)).toBe(true);
    expect(ENGINEERING_PREFIXES.map((p) => p.symbol)).toContain('µ');
    expect(ENGINEERING_PREFIXES.map((p) => p.symbol)).not.toContain('c');
  });

  it('accepts ascii and greek spellings of micro but canonicalizes to µ', () => {
    expect(prefixBySymbol('u')?.symbol).toBe('µ');
    expect(prefixBySymbol('μ')?.symbol).toBe('µ');
    expect(prefixBySymbol('µ')?.name).toBe('micro');
  });

  it('steps engineering exponents down to the nearest multiple of three', () => {
    expect(engineeringExponentFor(0)).toBe(0);
    expect(engineeringExponentFor(2)).toBe(0);
    expect(engineeringExponentFor(3)).toBe(3);
    expect(engineeringExponentFor(-1)).toBe(-3);
    expect(engineeringExponentFor(-6)).toBe(-6);
  });

  it('clamps beyond the defined prefix range instead of inventing prefixes', () => {
    expect(engineeringExponentFor(45)).toBe(30);
    expect(engineeringExponentFor(-45)).toBe(-30);
  });
});

describe('unit resolution', () => {
  it('resolves base units', () => {
    expect(findUnit('m')?.dimension).toBe('length');
    expect(findUnit('s')?.dimension).toBe('time');
    expect(findUnit('m')?.toCanonical).toEqual(rational(1n));
  });

  it('resolves prefixed units exactly', () => {
    expect(findUnit('mm')?.toCanonical).toEqual(rational(1n, 1000n));
    expect(findUnit('km')?.toCanonical).toEqual(rational(1000n));
    expect(findUnit('cm')?.toCanonical).toEqual(rational(1n, 100n));
    expect(findUnit('µm')?.toCanonical).toEqual(pow10(-6));
    expect(findUnit('um')?.symbol).toBe('µm');
    expect(findUnit('nm')?.toCanonical).toEqual(pow10(-9));
    expect(findUnit('Gm')?.toCanonical).toEqual(pow10(9));
    expect(findUnit('dam')?.toCanonical).toEqual(rational(10n));
  });

  it('disambiguates ms as millisecond, not milli-metre', () => {
    const unit = requireUnit('ms');
    expect(unit.dimension).toBe('time');
    expect(unit.toCanonical).toEqual(rational(1n, 1000n));
  });

  it('keeps non-prefixable time units out of the prefix decomposition', () => {
    expect(requireUnit('min').toCanonical).toEqual(rational(60n));
    expect(requireUnit('h').toCanonical).toEqual(rational(3600n));
    expect(requireUnit('d').toCanonical).toEqual(rational(86400n));
    expect(requireUnit('a').toCanonical).toEqual(rational(31557600n));
    // `da` is a prefix, not a unit.
    expect(findUnit('da')).toBeUndefined();
  });

  it('rejects unknown symbols', () => {
    expect(findUnit('parsec')).toBeUndefined();
    expect(findUnit('')).toBeUndefined();
    expect(() => requireUnit('kg')).toThrow(UnitError);
  });
});

describe('conversionFactor', () => {
  it('converts exactly within a dimension', () => {
    expect(conversionFactor(requireUnit('mm'), requireUnit('m'))).toEqual(rational(1n, 1000n));
    expect(conversionFactor(requireUnit('km'), requireUnit('mm'))).toEqual(rational(1000000n));
    expect(equals(conversionFactor(requireUnit('m'), requireUnit('m')), rational(1n))).toBe(true);
  });

  it('round-trips without loss', () => {
    const there = conversionFactor(requireUnit('µm'), requireUnit('km'));
    const back = conversionFactor(requireUnit('km'), requireUnit('µm'));
    expect(
      equals(
        rational(there.numerator * back.numerator, there.denominator * back.denominator),
        rational(1n),
      ),
    ).toBe(true);
  });

  it('refuses cross-dimension conversion', () => {
    expect(() => conversionFactor(requireUnit('m'), requireUnit('s'))).toThrow(UnitError);
  });
});
