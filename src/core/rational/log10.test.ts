import { describe, expect, it } from 'vitest';
import {
  decomposeDecimal,
  log10RationalForDisplay,
  orderOfMagnitude10,
  orderOfMagnitude2,
  toNumberForDisplay,
} from './log10';
import { ONE, RationalError, ZERO, gte, lt, pow10, pow2, rational, sub } from './rational';
import { parseDecimalExact } from './parse';

const r = rational;

describe('orderOfMagnitude10', () => {
  it('finds the decade of ordinary values', () => {
    expect(orderOfMagnitude10(ONE)).toBe(0);
    expect(orderOfMagnitude10(r(9n))).toBe(0);
    expect(orderOfMagnitude10(r(10n))).toBe(1);
    expect(orderOfMagnitude10(r(1n, 10n))).toBe(-1);
    expect(orderOfMagnitude10(r(1n, 1000n))).toBe(-3);
    expect(orderOfMagnitude10(r(999n, 1000n))).toBe(-1);
  });

  it('uses magnitude only', () => {
    expect(orderOfMagnitude10(r(-1234n))).toBe(3);
  });

  it('is exact at decade boundaries where a float estimate would slip', () => {
    for (let e = -60; e <= 60; e += 1) {
      expect(orderOfMagnitude10(pow10(e))).toBe(e);
      // Just below the boundary must belong to the previous decade.
      expect(orderOfMagnitude10(r(pow10(e).numerator * 10n - 1n, pow10(e).denominator * 10n))).toBe(
        e - 1,
      );
    }
  });

  it('works far outside binary64 exponent range', () => {
    // The observable universe in Planck lengths is ~10^61; these are worse.
    expect(orderOfMagnitude10(pow10(400))).toBe(400);
    expect(orderOfMagnitude10(pow10(-400))).toBe(-400);
    expect(orderOfMagnitude10(r(2n ** 4000n))).toBe(1204);
  });

  it('is undefined at zero', () => {
    expect(() => orderOfMagnitude10(ZERO)).toThrow(RationalError);
  });
});

describe('orderOfMagnitude2', () => {
  it('brackets the value between adjacent powers of two', () => {
    expect(orderOfMagnitude2(ONE)).toBe(0);
    expect(orderOfMagnitude2(r(2n))).toBe(1);
    expect(orderOfMagnitude2(r(3n))).toBe(1);
    expect(orderOfMagnitude2(r(1n, 2n))).toBe(-1);
    expect(orderOfMagnitude2(r(3n, 4n))).toBe(-1);
    expect(orderOfMagnitude2(r(-5n))).toBe(2);
  });

  it('is exact at every power-of-two boundary', () => {
    for (let e = -1100; e <= 1100; e += 1) {
      expect(orderOfMagnitude2(pow2(e))).toBe(e);
      // Just below the boundary belongs to the previous binade.
      expect(orderOfMagnitude2(sub(pow2(e), pow2(e - 60)))).toBe(e - 1);
    }
  });

  it('covers the whole binary64 exponent range and well past it', () => {
    // The binary64 encoder relies on this for subnormals and for overflow.
    expect(orderOfMagnitude2(pow2(-1074))).toBe(-1074);
    expect(orderOfMagnitude2(pow2(1023))).toBe(1023);
    expect(orderOfMagnitude2(pow2(5000))).toBe(5000);
  });

  it('is undefined at zero', () => {
    expect(() => orderOfMagnitude2(ZERO)).toThrow(RationalError);
  });
});

describe('decomposeDecimal', () => {
  it('normalizes the mantissa into [1, 10)', () => {
    const samples = [r(1n), r(9999n), r(1n, 7n), pow10(400), pow10(-400), r(-12345n, 7n)];
    for (const sample of samples) {
      const { mantissa } = decomposeDecimal(sample);
      expect(gte(mantissa, ONE)).toBe(true);
      expect(lt(mantissa, r(10n))).toBe(true);
    }
  });

  it('keeps the mantissa exact', () => {
    expect(decomposeDecimal(r(1234n))).toEqual({
      sign: 1,
      exponent: 3,
      mantissa: { numerator: 617n, denominator: 500n },
    });
  });

  it('reports zero without inventing an exponent', () => {
    expect(decomposeDecimal(ZERO)).toEqual({ sign: 0, exponent: 0, mantissa: ZERO });
  });
});

describe('log10RationalForDisplay', () => {
  it('matches Math.log10 inside binary64 range', () => {
    for (const value of [1, 2, 7, 10, 999, 1e6]) {
      expect(log10RationalForDisplay(r(BigInt(value)))).toBeCloseTo(Math.log10(value), 12);
    }
    expect(log10RationalForDisplay(r(1n, 8n))).toBeCloseTo(Math.log10(0.125), 12);
  });

  it('returns a finite bounded result for values binary64 cannot hold', () => {
    // 1e400 is Infinity as a double, so Math.log10(Number(...)) cannot do this.
    expect(log10RationalForDisplay(pow10(400))).toBeCloseTo(400, 9);
    expect(log10RationalForDisplay(pow10(-400))).toBeCloseTo(-400, 9);
    expect(log10RationalForDisplay(parseDecimalExact('1.6e-35'))).toBeCloseTo(-34.79588, 4);

    const universeInPlanckLengths = parseDecimalExact('5.4e61');
    expect(log10RationalForDisplay(universeInPlanckLengths)).toBeCloseTo(61.7324, 3);
  });

  it('is monotonically increasing across the atlas range', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let e = -400; e <= 400; e += 1) {
      const current = log10RationalForDisplay(pow10(e));
      expect(current).toBeGreaterThan(previous);
      expect(Number.isFinite(current)).toBe(true);
      previous = current;
    }
  });

  it('refuses zero and negative values', () => {
    expect(() => log10RationalForDisplay(ZERO)).toThrow(RationalError);
    expect(() => log10RationalForDisplay(r(-1n))).toThrow(RationalError);
  });
});

describe('toNumberForDisplay', () => {
  it('converts bounded values accurately', () => {
    expect(toNumberForDisplay(r(1n, 4n))).toBe(0.25);
    expect(toNumberForDisplay(r(-3n, 2n))).toBe(-1.5);
    expect(toNumberForDisplay(ZERO)).toBe(0);
    expect(toNumberForDisplay(r(1n, 3n))).toBeCloseTo(1 / 3, 15);
  });

  it('saturates rather than producing garbage out of range', () => {
    expect(toNumberForDisplay(pow10(400))).toBe(Number.POSITIVE_INFINITY);
    expect(toNumberForDisplay(r(-1n * 10n ** 400n))).toBe(Number.NEGATIVE_INFINITY);
    expect(toNumberForDisplay(pow10(-400))).toBe(0);
  });
});
