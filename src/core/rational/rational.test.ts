import { describe, expect, it } from 'vitest';
import {
  ONE,
  type Rational,
  RationalError,
  ZERO,
  abs,
  add,
  bitLength,
  ceilToBigInt,
  compare,
  div,
  equals,
  floorToBigInt,
  fromBigInt,
  fromSafeInteger,
  hasTerminatingDecimal,
  inv,
  isInteger,
  isZero,
  max,
  min,
  mul,
  neg,
  pow,
  pow10,
  pow2,
  rational,
  roundNearestEvenToBigInt,
  roundToBigInt,
  sign,
  sub,
  truncateToBigInt,
} from './rational';

const r = rational;

describe('normalization', () => {
  it('reduces by the greatest common divisor', () => {
    expect(r(6n, 8n)).toEqual({ numerator: 3n, denominator: 4n });
    expect(r(1000000n, 1000n)).toEqual({ numerator: 1000n, denominator: 1n });
  });

  it('folds a negative denominator into the numerator', () => {
    expect(r(1n, -2n)).toEqual({ numerator: -1n, denominator: 2n });
    expect(r(-1n, -2n)).toEqual({ numerator: 1n, denominator: 2n });
  });

  it('canonicalizes every representation of zero', () => {
    expect(r(0n, 5n)).toEqual(ZERO);
    expect(r(0n, -5n)).toEqual(ZERO);
    expect(r(-0n, 7n)).toEqual(ZERO);
  });

  it('rejects a zero denominator', () => {
    expect(() => r(1n, 0n)).toThrow(RationalError);
  });

  it('preserves value through normalization for huge bigints', () => {
    const big = 2n ** 300n;
    const value = r(big * 3n, big * 9n);
    expect(value).toEqual({ numerator: 1n, denominator: 3n });
  });
});

describe('construction', () => {
  it('builds from bigint', () => {
    expect(fromBigInt(-7n)).toEqual({ numerator: -7n, denominator: 1n });
    expect(fromBigInt(0n)).toEqual(ZERO);
  });

  it('accepts safe integers and rejects anything else', () => {
    expect(fromSafeInteger(42)).toEqual({ numerator: 42n, denominator: 1n });
    expect(() => fromSafeInteger(0.5)).toThrow(RationalError);
    expect(() => fromSafeInteger(Number.MAX_SAFE_INTEGER + 2)).toThrow(RationalError);
  });
});

describe('arithmetic', () => {
  it('adds exactly where binary64 cannot', () => {
    // The headline experiment: 0.1 + 0.2 is exactly 3/10 in the exact reference.
    expect(add(r(1n, 10n), r(2n, 10n))).toEqual({ numerator: 3n, denominator: 10n });
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('returns 1 for (1/10) × 10', () => {
    expect(mul(r(1n, 10n), r(10n))).toEqual(ONE);
  });

  it('returns 1 for 1/3 + 1/3 + 1/3', () => {
    const third = r(1n, 3n);
    expect(add(add(third, third), third)).toEqual(ONE);
  });

  it('subtracts, multiplies, divides and negates', () => {
    expect(sub(r(3n, 4n), r(1n, 4n))).toEqual({ numerator: 1n, denominator: 2n });
    expect(mul(r(2n, 3n), r(3n, 2n))).toEqual(ONE);
    expect(div(r(1n, 2n), r(1n, 4n))).toEqual({ numerator: 2n, denominator: 1n });
    expect(neg(r(-5n, 3n))).toEqual({ numerator: 5n, denominator: 3n });
    expect(neg(ZERO)).toEqual(ZERO);
    expect(abs(r(-5n, 3n))).toEqual({ numerator: 5n, denominator: 3n });
  });

  it('refuses division and inversion by exact zero', () => {
    expect(() => div(ONE, ZERO)).toThrow(RationalError);
    expect(() => inv(ZERO)).toThrow(RationalError);
  });

  it('is associative under addition', () => {
    const a = r(1n, 7n);
    const b = r(3n, 11n);
    const c = r(-5n, 13n);
    expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
  });

  it('survives a million-term style accumulation of 1/1000', () => {
    // 1000 × (1/1000) must be exactly 1 with no drift.
    let acc = ZERO;
    for (let i = 0; i < 1000; i += 1) {
      acc = add(acc, r(1n, 1000n));
    }
    expect(acc).toEqual(ONE);
  });
});

describe('comparison', () => {
  it('orders exactly', () => {
    expect(compare(r(1n, 3n), r(1n, 2n))).toBe(-1);
    expect(compare(r(1n, 2n), r(2n, 4n))).toBe(0);
    expect(compare(r(-1n, 3n), r(-1n, 2n))).toBe(1);
  });

  it('treats structural equality as value equality for normalized values', () => {
    expect(equals(r(2n, 4n), r(1n, 2n))).toBe(true);
    expect(equals(r(2n, 4n), r(1n, 3n))).toBe(false);
  });

  it('reports sign, zero and integer-ness', () => {
    expect(sign(r(-3n, 2n))).toBe(-1);
    expect(sign(ZERO)).toBe(0);
    expect(sign(ONE)).toBe(1);
    expect(isZero(ZERO)).toBe(true);
    expect(isInteger(r(4n, 2n))).toBe(true);
    expect(isInteger(r(1n, 2n))).toBe(false);
  });

  it('picks min and max', () => {
    expect(min(r(1n, 3n), r(1n, 2n))).toEqual(r(1n, 3n));
    expect(max(r(1n, 3n), r(1n, 2n))).toEqual(r(1n, 2n));
  });
});

describe('powers', () => {
  it('computes exact powers of two in both directions', () => {
    expect(pow2(0)).toEqual(ONE);
    expect(pow2(10)).toEqual({ numerator: 1024n, denominator: 1n });
    expect(pow2(-3)).toEqual({ numerator: 1n, denominator: 8n });
    // The Q128.128 LSB at base unit m.
    expect(pow2(-128).denominator).toBe(2n ** 128n);
  });

  it('computes exact powers of ten in both directions', () => {
    expect(pow10(3)).toEqual({ numerator: 1000n, denominator: 1n });
    expect(pow10(-3)).toEqual({ numerator: 1n, denominator: 1000n });
    // Far outside binary64's exponent range.
    expect(pow10(400).numerator).toBe(10n ** 400n);
  });

  it('raises rationals to signed integer powers', () => {
    expect(pow(r(2n, 3n), 3)).toEqual({ numerator: 8n, denominator: 27n });
    expect(pow(r(2n, 3n), -2)).toEqual({ numerator: 9n, denominator: 4n });
    expect(pow(r(5n, 7n), 0)).toEqual(ONE);
  });
});

describe('rounding to integers', () => {
  interface RoundingCase {
    label: string;
    value: Rational;
    floor: bigint;
    ceil: bigint;
    truncate: bigint;
    nearestEven: bigint;
  }

  const cases: readonly RoundingCase[] = [
    { label: '7/2', value: r(7n, 2n), floor: 3n, ceil: 4n, truncate: 3n, nearestEven: 4n },
    { label: '5/2', value: r(5n, 2n), floor: 2n, ceil: 3n, truncate: 2n, nearestEven: 2n },
    { label: '-5/2', value: r(-5n, 2n), floor: -3n, ceil: -2n, truncate: -2n, nearestEven: -2n },
    { label: '-7/2', value: r(-7n, 2n), floor: -4n, ceil: -3n, truncate: -3n, nearestEven: -4n },
    { label: '1/3', value: r(1n, 3n), floor: 0n, ceil: 1n, truncate: 0n, nearestEven: 0n },
    { label: '-1/3', value: r(-1n, 3n), floor: -1n, ceil: 0n, truncate: 0n, nearestEven: 0n },
    { label: '4', value: r(4n), floor: 4n, ceil: 4n, truncate: 4n, nearestEven: 4n },
    { label: '-4', value: r(-4n), floor: -4n, ceil: -4n, truncate: -4n, nearestEven: -4n },
  ];

  for (const testCase of cases) {
    it(`rounds ${testCase.label}`, () => {
      expect(floorToBigInt(testCase.value)).toBe(testCase.floor);
      expect(ceilToBigInt(testCase.value)).toBe(testCase.ceil);
      expect(truncateToBigInt(testCase.value)).toBe(testCase.truncate);
      expect(roundNearestEvenToBigInt(testCase.value)).toBe(testCase.nearestEven);
    });
  }

  it('dispatches by named mode', () => {
    expect(roundToBigInt(r(5n, 2n), 'nearest-even')).toBe(2n);
    expect(roundToBigInt(r(5n, 2n), 'floor')).toBe(2n);
    expect(roundToBigInt(r(5n, 2n), 'ceil')).toBe(3n);
    expect(roundToBigInt(r(-5n, 2n), 'truncate')).toBe(-2n);
  });

  it('never rounds further than half an LSB away', () => {
    for (let n = -40n; n <= 40n; n += 1n) {
      for (let d = 1n; d <= 12n; d += 1n) {
        const value = r(n, d);
        const rounded = roundNearestEvenToBigInt(value);
        const error = abs(sub(fromBigInt(rounded), value));
        expect(compare(error, r(1n, 2n))).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('decimal terminability', () => {
  it('accepts denominators built only from 2 and 5', () => {
    expect(hasTerminatingDecimal(r(1n, 8n))).toBe(true);
    expect(hasTerminatingDecimal(r(1n, 10n))).toBe(true);
    expect(hasTerminatingDecimal(r(3n, 1n))).toBe(true);
  });

  it('rejects repeating expansions', () => {
    expect(hasTerminatingDecimal(r(1n, 3n))).toBe(false);
    expect(hasTerminatingDecimal(r(1n, 7n))).toBe(false);
  });
});

describe('bitLength', () => {
  it('measures the magnitude only', () => {
    expect(bitLength(0n)).toBe(0);
    expect(bitLength(1n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(-256n)).toBe(9);
    expect(bitLength(2n ** 255n)).toBe(256);
  });
});
